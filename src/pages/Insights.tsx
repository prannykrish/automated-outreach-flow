import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from "recharts";
import { Mail, Eye, MessageSquare, AlertCircle } from "lucide-react";
import { format, subDays } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export default function Insights() {
  const { organizationId } = useAuth();
  const [sequenceFilter, setSequenceFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month" | "all">("all");

  // Get all sequences for filter
  const { data: sequences } = useQuery({
    queryKey: ["sequences-for-filter", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Get all templates for filter
  const { data: templates } = useQuery({
    queryKey: ["templates-for-filter", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Get email logs by organization_id (not user_id)
  // This ensures all org members see shared analytics
  const { data: emailLogs, isLoading } = useQuery({
    queryKey: ["email-logs-analytics", organizationId, templateFilter],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = supabase
        .from("email_logs")
        .select(`
          *,
          email_templates(id, name),
          customers(id, sequence_id, first_name, last_name, email)
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (templateFilter !== "all") {
        query = query.eq("template_id", templateFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Calculate date filter
  const getFilteredLogs = () => {
    if (!emailLogs) return [];
    const now = new Date();
    let cutoffDate = new Date();

    switch (timeRange) {
      case "day":
        cutoffDate = subDays(now, 1);
        break;
      case "week":
        cutoffDate = subDays(now, 7);
        break;
      case "month":
        cutoffDate = subDays(now, 30);
        break;
      case "all":
        cutoffDate = new Date(0);
        break;
    }

    let filtered = emailLogs.filter((log: any) => new Date(log.created_at) >= cutoffDate);

    // Filter by sequence if selected (only for logs that still have customer data)
    if (sequenceFilter !== "all") {
      filtered = filtered.filter((log: any) => log.customers?.sequence_id === sequenceFilter);
    }

    return filtered;
  };

  const filteredLogs = getFilteredLogs();

  // Calculate statistics
  const stats = {
    totalSent: filteredLogs.filter((log: any) => log.status === "sent").length,
    totalOpened: filteredLogs.filter((log: any) => log.opened_at).length,
    totalReplied: filteredLogs.filter((log: any) => log.replied_at).length,
    totalFailed: filteredLogs.filter((log: any) => log.status === "failed").length,
    openRate: 0,
    replyRate: 0,
  };

  const sentCount = stats.totalSent;
  stats.openRate = sentCount ? Number(((stats.totalOpened / sentCount) * 100).toFixed(1)) : 0;
  stats.replyRate = sentCount ? Number(((stats.totalReplied / sentCount) * 100).toFixed(1)) : 0;

  // Group by sequence for breakdown
  function groupBySequence() {
    const groups: { [key: string]: any } = {};
    filteredLogs.forEach((log: any) => {
      const seqId = log.customers?.sequence_id || "unknown";
      const seqName = sequences?.find((s: any) => s.id === seqId)?.name || "Deleted/Unknown";
      if (!groups[seqId]) {
        groups[seqId] = {
          id: seqId,
          name: seqName,
          sent: 0,
          opened: 0,
          replied: 0,
          failed: 0,
        };
      }
      if (log.status === "sent") groups[seqId].sent++;
      if (log.opened_at) groups[seqId].opened++;
      if (log.replied_at) groups[seqId].replied++;
      if (log.status === "failed") groups[seqId].failed++;
    });
    return Object.values(groups).filter((g: any) => g.sent > 0);
  }

  // Group by template for breakdown
  function groupByTemplate() {
    const groups: { [key: string]: any } = {};
    filteredLogs.forEach((log: any) => {
      const templateId = log.template_id || "unknown";
      const templateName = log.email_templates?.name || "Deleted/Unknown";
      if (!groups[templateId]) {
        groups[templateId] = {
          id: templateId,
          name: templateName,
          sent: 0,
          opened: 0,
          replied: 0,
          failed: 0,
        };
      }
      if (log.status === "sent") groups[templateId].sent++;
      if (log.opened_at) groups[templateId].opened++;
      if (log.replied_at) groups[templateId].replied++;
      if (log.status === "failed") groups[templateId].failed++;
    });
    return Object.values(groups).filter((g: any) => g.sent > 0);
  }

  const sequenceBreakdown = sequenceFilter === "all" ? groupBySequence() : [];
  const templateBreakdown = templateFilter === "all" ? groupByTemplate() : [];

  // Time-based data
  function getTimeSeriesData() {
    const groups: { [key: string]: any } = {};
    filteredLogs.forEach((log: any) => {
      let dateKey: string;
      const date = new Date(log.created_at);

      switch (timeRange) {
        case "day":
          dateKey = format(date, "HH:00");
          break;
        case "week":
          dateKey = format(date, "EEE");
          break;
        case "month":
          dateKey = format(date, "MMM dd");
          break;
        case "all":
          dateKey = format(date, "MMM yyyy");
          break;
      }

      if (!groups[dateKey]) {
        groups[dateKey] = { date: dateKey, sent: 0, opened: 0, replied: 0, failed: 0 };
      }
      if (log.status === "sent") groups[dateKey].sent++;
      if (log.opened_at) groups[dateKey].opened++;
      if (log.replied_at) groups[dateKey].replied++;
      if (log.status === "failed") groups[dateKey].failed++;
    });

    return Object.values(groups);
  }

  const timeSeriesData = getTimeSeriesData();

  // Funnel data
  const funnelData = [
    { name: "Sent", value: stats.totalSent, fill: "#3b82f6" },
    { name: "Opened", value: stats.totalOpened, fill: "#10b981" },
    { name: "Replied", value: stats.totalReplied, fill: "#8b5cf6" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Analytics & Insights</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Analytics & Insights</h1>
        <p className="text-muted-foreground">Track email performance, engagement, and campaign metrics</p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Time Period</label>
          <Select value={timeRange} onValueChange={(val: any) => setTimeRange(val)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Last 24 Hours</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last 30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block">Filter by Sequence</label>
          <Select value={sequenceFilter} onValueChange={setSequenceFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sequences</SelectItem>
              {sequences?.map((seq: any) => (
                <SelectItem key={seq.id} value={seq.id}>
                  {seq.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block">Filter by Template</label>
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Templates</SelectItem>
              {templates?.map((tpl: any) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
            <Mail className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSent}</div>
            <p className="text-xs text-muted-foreground">
              {timeRange === "all" ? "all time" : `last ${timeRange}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Opened</CardTitle>
            <Eye className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOpened}</div>
            <p className="text-xs text-muted-foreground">{stats.openRate}% open rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Replied</CardTitle>
            <MessageSquare className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReplied}</div>
            <p className="text-xs text-muted-foreground">{stats.replyRate}% reply rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalFailed}</div>
            <p className="text-xs text-muted-foreground">delivery errors</p>
          </CardContent>
        </Card>
      </div>

      {/* No Data State */}
      {filteredLogs.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No email data for the selected filters.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Send some emails to see your analytics here.
            </p>
          </CardContent>
        </Card>
      )}

      {filteredLogs.length > 0 && (
        <>
          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Email Volume Over Time */}
            <Card>
              <CardHeader>
                <CardTitle>Email Volume Over Time</CardTitle>
                <CardDescription>Emails sent, opened, and replied</CardDescription>
              </CardHeader>
              <CardContent>
                {timeSeriesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={timeSeriesData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="sent" stroke="#3b82f6" name="Sent" strokeWidth={2} />
                      <Line type="monotone" dataKey="opened" stroke="#10b981" name="Opened" strokeWidth={2} />
                      <Line type="monotone" dataKey="replied" stroke="#8b5cf6" name="Replied" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No data to display
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Funnel Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Email Funnel</CardTitle>
                <CardDescription>Conversion from sent to engagement</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={funnelData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={80} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                      <LabelList dataKey="value" position="right" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Performance by Sequence */}
          {sequenceFilter === "all" && sequenceBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Performance by Sequence</CardTitle>
                <CardDescription>Email metrics broken down by sequence</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={sequenceBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
                    <Bar dataKey="opened" fill="#10b981" name="Opened" />
                    <Bar dataKey="replied" fill="#8b5cf6" name="Replied" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Performance by Template */}
          {templateFilter === "all" && templateBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Performance by Template</CardTitle>
                <CardDescription>Email metrics broken down by template</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={templateBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
                    <Bar dataKey="opened" fill="#10b981" name="Opened" />
                    <Bar dataKey="replied" fill="#8b5cf6" name="Replied" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Detailed Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Sequences */}
            {sequenceFilter === "all" && sequenceBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Sequences by Engagement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {sequenceBreakdown
                      .sort((a: any, b: any) => (b.opened + b.replied) - (a.opened + a.replied))
                      .slice(0, 5)
                      .map((seq: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between pb-2 border-b last:border-b-0">
                          <div>
                            <p className="font-medium">{seq.name}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {seq.sent} sent
                              </Badge>
                              <Badge variant="outline" className="text-xs text-green-600">
                                {seq.sent > 0 ? ((seq.opened / seq.sent) * 100).toFixed(0) : 0}% open
                              </Badge>
                              <Badge variant="outline" className="text-xs text-purple-600">
                                {seq.sent > 0 ? ((seq.replied / seq.sent) * 100).toFixed(0) : 0}% reply
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top Templates */}
            {templateFilter === "all" && templateBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Top Templates by Engagement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {templateBreakdown
                      .sort((a: any, b: any) => (b.opened + b.replied) - (a.opened + a.replied))
                      .slice(0, 5)
                      .map((tpl: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between pb-2 border-b last:border-b-0">
                          <div>
                            <p className="font-medium">{tpl.name}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {tpl.sent} sent
                              </Badge>
                              <Badge variant="outline" className="text-xs text-green-600">
                                {tpl.sent > 0 ? ((tpl.opened / tpl.sent) * 100).toFixed(0) : 0}% open
                              </Badge>
                              <Badge variant="outline" className="text-xs text-purple-600">
                                {tpl.sent > 0 ? ((tpl.replied / tpl.sent) * 100).toFixed(0) : 0}% reply
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Email Activity</CardTitle>
              <CardDescription>Latest 10 emails sent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {filteredLogs.slice(0, 10).map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        log.replied_at ? "bg-purple-500" :
                        log.opened_at ? "bg-green-500" :
                        log.status === "sent" ? "bg-blue-500" :
                        "bg-red-500"
                      }`} />
                      <div>
                        <p className="font-medium text-sm">
                          {log.customers?.first_name
                            ? `${log.customers.first_name} ${log.customers.last_name || ""}`.trim()
                            : log.customer_name || log.customer_email || "Deleted Customer"
                          }
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {log.email_templates?.name || "Unknown Template"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {log.replied_at && (
                        <Badge className="bg-purple-500 text-xs">Replied</Badge>
                      )}
                      {log.opened_at && !log.replied_at && (
                        <Badge className="bg-green-500 text-xs">Opened</Badge>
                      )}
                      {log.status === "sent" && !log.opened_at && (
                        <Badge variant="outline" className="text-xs">Sent</Badge>
                      )}
                      {log.status === "failed" && (
                        <Badge variant="destructive" className="text-xs">Failed</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}