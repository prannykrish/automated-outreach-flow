import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, FunnelChart, Funnel } from "recharts";
import { Mail, Eye, MessageSquare, CheckCircle, TrendingUp, Calendar } from "lucide-react";
import { format, subDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";

export default function Insights() {
  const [sequenceFilter, setSequenceFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month" | "all">("month");

  // Get all sequences for filter
  const { data: sequences } = useQuery({
    queryKey: ["sequences-for-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as any;
    },
  });

  // Get all templates for filter
  const { data: templates } = useQuery({
    queryKey: ["templates-for-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as any;
    },
  });

  // Get email logs with related data
  const { data: emailLogs } = useQuery({
    queryKey: ["email-logs-analytics", sequenceFilter, templateFilter],
    queryFn: async () => {
      let query = supabase
        .from("email_logs")
        .select("*, customers(sequence_id), email_templates(name, folder_id)");

      if (templateFilter !== "all") {
        query = query.eq("template_id", templateFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter by sequence if selected
      if (sequenceFilter !== "all") {
        return (data as any)?.filter(
          (log: any) => log.customers?.sequence_id === sequenceFilter
        ) || [];
      }

      return data as any;
    },
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

    return emailLogs.filter((log: any) => new Date(log.created_at) >= cutoffDate);
  };

  const filteredLogs = getFilteredLogs();

  // Calculate statistics
  const stats = {
    totalSent: filteredLogs.length,
    totalOpened: filteredLogs.filter((log: any) => log.opened_at).length,
    totalReplied: filteredLogs.filter((log: any) => log.replied_at).length,
    totalFailed: filteredLogs.filter((log: any) => log.status === "failed").length,
    openRate: filteredLogs.length ? ((filteredLogs.filter((log: any) => log.opened_at).length / filteredLogs.length) * 100).toFixed(1) : 0,
    replyRate: filteredLogs.length ? ((filteredLogs.filter((log: any) => log.replied_at).length / filteredLogs.length) * 100).toFixed(1) : 0,
  };

  // Group by sequence for breakdown
  const sequenceBreakdown = sequenceFilter === "all" ? groupBySequence() : [];

  function groupBySequence() {
    const groups: { [key: string]: any } = {};
    filteredLogs.forEach((log: any) => {
      const seqId = log.customers?.sequence_id;
      const seqName = sequences?.find((s: any) => s.id === seqId)?.name || "Unknown";
      if (!groups[seqId]) {
        groups[seqId] = {
          name: seqName,
          sent: 0,
          opened: 0,
          replied: 0,
          failed: 0,
        };
      }
      groups[seqId].sent++;
      if (log.opened_at) groups[seqId].opened++;
      if (log.replied_at) groups[seqId].replied++;
      if (log.status === "failed") groups[seqId].failed++;
    });
    return Object.values(groups);
  }

  // Group by template for breakdown
  const templateBreakdown = templateFilter === "all" ? groupByTemplate() : [];

  function groupByTemplate() {
    const groups: { [key: string]: any } = {};
    filteredLogs.forEach((log: any) => {
      const templateId = log.template_id;
      const templateName = log.email_templates?.name || "Unknown";
      if (!groups[templateId]) {
        groups[templateId] = {
          name: templateName,
          sent: 0,
          opened: 0,
          replied: 0,
          failed: 0,
        };
      }
      groups[templateId].sent++;
      if (log.opened_at) groups[templateId].opened++;
      if (log.replied_at) groups[templateId].replied++;
      if (log.status === "failed") groups[templateId].failed++;
    });
    return Object.values(groups);
  }

  // Time-based data
  const timeSeriesData = getTimeSeriesData();

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
      groups[dateKey].sent++;
      if (log.opened_at) groups[dateKey].opened++;
      if (log.replied_at) groups[dateKey].replied++;
      if (log.status === "failed") groups[dateKey].failed++;
    });

    return Object.values(groups);
  }

  // Funnel data
  const funnelData = [
    { name: "Sent", value: stats.totalSent },
    { name: "Opened", value: stats.totalOpened },
    { name: "Replied", value: stats.totalReplied },
  ];

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

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
            <p className="text-xs text-muted-foreground">in {timeRange === "all" ? "all time" : timeRange}</p>
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
            <CheckCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalFailed}</div>
            <p className="text-xs text-muted-foreground">delivery errors</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Volume Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Email Volume Over Time</CardTitle>
            <CardDescription>Emails sent, opened, and replied to over {timeRange}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sent" stroke="#3b82f6" name="Sent" />
                <Line type="monotone" dataKey="opened" stroke="#10b981" name="Opened" />
                <Line type="monotone" dataKey="replied" stroke="#8b5cf6" name="Replied" />
              </LineChart>
            </ResponsiveContainer>
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
              <FunnelChart>
                <Tooltip />
                <Funnel dataKey="value" data={funnelData} fill="#3b82f6">
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      {sequenceFilter === "all" && (
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

      {/* Charts Row 3 */}
      {templateFilter === "all" && (
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
        {sequenceFilter === "all" && (
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
                          <Badge variant="outline" className="text-xs">
                            {((seq.opened / seq.sent) * 100).toFixed(0)}% open
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {((seq.replied / seq.sent) * 100).toFixed(0)}% reply
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
        {templateFilter === "all" && (
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
                          <Badge variant="outline" className="text-xs">
                            {((tpl.opened / tpl.sent) * 100).toFixed(0)}% open
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {((tpl.replied / tpl.sent) * 100).toFixed(0)}% reply
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
    </div>
  );
}
