import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
} from "recharts";
import { Mail, Eye, MessageSquare, ArrowDownLeft, Ban, MousePointerClick, CheckCircle, TrendingUp, Users, Send, AlertTriangle, ExternalLink } from "lucide-react";
import { format, subDays } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_COLORS: Record<string, string> = {
  sent: "#3b82f6",
  delivered: "#06b6d4",
  opened: "#10b981",
  clicked: "#f59e0b",
  replied: "#8b5cf6",
  bounced: "#ef4444",
  complained: "#dc2626",
  failed: "#6b7280",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-blue-500 text-white" },
  delivered: { label: "Delivered", className: "bg-cyan-500 text-white" },
  opened: { label: "Opened", className: "bg-green-500 text-white" },
  clicked: { label: "Clicked", className: "bg-yellow-500 text-white" },
  replied: { label: "Replied", className: "bg-purple-500 text-white" },
  bounced: { label: "Bounced", className: "bg-red-500 text-white" },
  complained: { label: "Complaint", className: "bg-red-700 text-white" },
  failed: { label: "Failed", className: "bg-gray-500 text-white" },
};

function getEventStatus(log: any): string {
  if (log.replied_at) return "replied";
  if (log.clicked_at) return "clicked";
  if (log.opened_at) return "opened";
  if (log.bounce_type === "complaint") return "complained";
  if (log.bounce_type === "bounce" || log.status === "bounced") return "bounced";
  if (log.delivered_at || log.status === "delivered") return "delivered";
  if (log.status === "failed") return "failed";
  return "sent";
}

export default function Insights() {
  const { organizationId } = useAuth();
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month" | "all">("month");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");

  // Fetch campaigns for filter
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-for-filter", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_campaigns")
        .select("id, title, user_prompt, created_at")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Fetch all email logs
  const { data: emailLogs, isLoading } = useQuery({
    queryKey: ["email-logs-analytics", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_logs")
        .select(`*, customers(id, first_name, last_name, email, firm_name)`)
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Inbound count
  const { data: inboundCount } = useQuery({
    queryKey: ["inbound-count", organizationId],
    queryFn: async () => {
      const { count } = await supabase
        .from("inbound_emails")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!);
      return count || 0;
    },
    enabled: !!organizationId,
  });

  // Fetch research activity logs (sources used during campaigns)
  const { data: researchLogs } = useQuery({
    queryKey: ["research-activity", organizationId, campaignFilter],
    queryFn: async () => {
      let query = supabase
        .from("agent_activity_log")
        .select("id, campaign_id, step, message, detail, created_at")
        .in("step", ["prospect_harvester", "source_discovery", "research_summary", "icp_interpreter", "qualification"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (campaignFilter !== "all") {
        query = query.eq("campaign_id", campaignFilter);
      }
      const { data } = await query;
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (!emailLogs) return [];
    const now = new Date();
    let cutoff = new Date(0);
    if (timeRange === "day") cutoff = subDays(now, 1);
    else if (timeRange === "week") cutoff = subDays(now, 7);
    else if (timeRange === "month") cutoff = subDays(now, 30);

    return emailLogs.filter((log: any) => {
      const inTime = new Date(log.created_at) >= cutoff;
      const inCampaign = campaignFilter === "all" || log.campaign_id === campaignFilter;
      return inTime && inCampaign;
    });
  }, [emailLogs, timeRange, campaignFilter]);

  // Stats
  const stats = useMemo(() => {
    const s = { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, failed: 0, inbound: inboundCount || 0 };
    filteredLogs.forEach((log: any) => {
      s.sent++;
      if (log.delivered_at || log.status === "delivered") s.delivered++;
      if (log.opened_at) s.opened++;
      if (log.clicked_at) s.clicked++;
      if (log.replied_at) s.replied++;
      if (log.bounce_type) s.bounced++;
      if (log.status === "failed") s.failed++;
    });
    return {
      ...s,
      openRate: s.sent ? Number(((s.opened / s.sent) * 100).toFixed(1)) : 0,
      clickRate: s.sent ? Number(((s.clicked / s.sent) * 100).toFixed(1)) : 0,
      replyRate: s.sent ? Number(((s.replied / s.sent) * 100).toFixed(1)) : 0,
      bounceRate: s.sent ? Number(((s.bounced / s.sent) * 100).toFixed(1)) : 0,
      deliveryRate: s.sent ? Number(((s.delivered / s.sent) * 100).toFixed(1)) : 0,
    };
  }, [filteredLogs, inboundCount]);

  // Time series data
  const timeSeriesData = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredLogs.forEach((log: any) => {
      const date = new Date(log.created_at);
      let key: string;
      if (timeRange === "day") key = format(date, "HH:00");
      else if (timeRange === "week") key = format(date, "EEE");
      else if (timeRange === "month") key = format(date, "MMM dd");
      else key = format(date, "MMM yyyy");

      if (!groups[key]) groups[key] = { date: key, sent: 0, opened: 0, replied: 0, bounced: 0, clicked: 0 };
      groups[key].sent++;
      if (log.opened_at) groups[key].opened++;
      if (log.replied_at) groups[key].replied++;
      if (log.clicked_at) groups[key].clicked++;
      if (log.bounce_type) groups[key].bounced++;
    });
    return Object.values(groups);
  }, [filteredLogs, timeRange]);

  // Funnel data
  const funnelData = useMemo(() => [
    { name: "Sent", value: stats.sent, fill: STATUS_COLORS.sent },
    { name: "Delivered", value: stats.delivered, fill: STATUS_COLORS.delivered },
    { name: "Opened", value: stats.opened, fill: STATUS_COLORS.opened },
    { name: "Clicked", value: stats.clicked, fill: STATUS_COLORS.clicked },
    { name: "Replied", value: stats.replied, fill: STATUS_COLORS.replied },
  ], [stats]);

  // Pie chart for status breakdown
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLogs.forEach((log: any) => {
      const status = getEventStatus(log);
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name: STATUS_BADGE[name]?.label || name, value, fill: STATUS_COLORS[name] || "#999" }))
      .filter(d => d.value > 0);
  }, [filteredLogs]);

  // Campaign breakdown
  const campaignBreakdown = useMemo(() => {
    if (campaignFilter !== "all") return [];
    const groups: Record<string, any> = {};
    filteredLogs.forEach((log: any) => {
      const cid = log.campaign_id || "manual";
      if (!groups[cid]) {
        const camp = campaigns?.find((c: any) => c.id === cid);
        groups[cid] = {
          id: cid,
          name: camp?.title || camp?.user_prompt?.substring(0, 40) || (cid === "manual" ? "Manual / Sequence" : "Unknown"),
          sent: 0, opened: 0, replied: 0, bounced: 0, clicked: 0,
        };
      }
      groups[cid].sent++;
      if (log.opened_at) groups[cid].opened++;
      if (log.replied_at) groups[cid].replied++;
      if (log.clicked_at) groups[cid].clicked++;
      if (log.bounce_type) groups[cid].bounced++;
    });
    return Object.values(groups).filter((g: any) => g.sent > 0).sort((a: any, b: any) => b.sent - a.sent);
  }, [filteredLogs, campaigns, campaignFilter]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Loading analytics data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Full email performance, engagement, and campaign metrics</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={timeRange} onValueChange={(val: any) => setTimeRange(val)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Last 24 Hours</SelectItem>
            <SelectItem value="week">Last 7 Days</SelectItem>
            <SelectItem value="month">Last 30 Days</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {campaigns?.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title || c.user_prompt?.substring(0, 35) || "Untitled"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Sent", value: stats.sent, icon: Send, color: "text-blue-500" },
          { label: "Delivered", value: stats.delivered, icon: CheckCircle, color: "text-cyan-500", sub: `${stats.deliveryRate}%` },
          { label: "Opened", value: stats.opened, icon: Eye, color: "text-green-500", sub: `${stats.openRate}%` },
          { label: "Clicked", value: stats.clicked, icon: MousePointerClick, color: "text-yellow-500", sub: `${stats.clickRate}%` },
          { label: "Replied", value: stats.replied, icon: MessageSquare, color: "text-purple-500", sub: `${stats.replyRate}%` },
          { label: "Bounced", value: stats.bounced, icon: Ban, color: "text-red-500", sub: `${stats.bounceRate}%` },
          { label: "Inbound", value: stats.inbound, icon: ArrowDownLeft, color: "text-blue-400" },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{m.label}</span>
                <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
              </div>
              <p className="text-xl font-bold">{m.value}</p>
              {m.sub && <p className="text-[11px] text-muted-foreground">{m.sub} rate</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredLogs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Mail className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-muted-foreground">No email data for the selected filters.</p>
            <p className="text-sm text-muted-foreground mt-1">Send emails to see analytics here.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="prospects">Prospects</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Volume Over Time */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Email Volume</CardTitle>
                  <CardDescription>Sends, opens, and replies over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={timeSeriesData}>
                      <defs>
                        <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="openedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="sent" stroke="#3b82f6" fill="url(#sentGrad)" name="Sent" />
                      <Area type="monotone" dataKey="opened" stroke="#10b981" fill="url(#openedGrad)" name="Opened" />
                      <Area type="monotone" dataKey="replied" stroke="#8b5cf6" fill="transparent" name="Replied" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Funnel */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Conversion Funnel</CardTitle>
                  <CardDescription>From sent to engagement</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={funnelData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="name" type="category" width={70} className="text-xs" />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {funnelData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Status Pie Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Status Breakdown</CardTitle>
                  <CardDescription>Current event status distribution</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Bounce & Deliverability Health */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Deliverability Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { label: "Delivery Rate", value: stats.deliveryRate, target: 95, color: stats.deliveryRate >= 95 ? "bg-green-500" : stats.deliveryRate >= 85 ? "bg-yellow-500" : "bg-red-500" },
                    { label: "Open Rate", value: stats.openRate, target: 40, color: stats.openRate >= 30 ? "bg-green-500" : stats.openRate >= 15 ? "bg-yellow-500" : "bg-red-500" },
                    { label: "Reply Rate", value: stats.replyRate, target: 10, color: stats.replyRate >= 5 ? "bg-green-500" : stats.replyRate >= 2 ? "bg-yellow-500" : "bg-red-500" },
                    { label: "Bounce Rate", value: stats.bounceRate, target: 2, color: stats.bounceRate <= 2 ? "bg-green-500" : stats.bounceRate <= 5 ? "bg-yellow-500" : "bg-red-500", inverted: true },
                  ].map((m) => (
                    <div key={m.label} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span>{m.label}</span>
                        <span className="font-medium">{m.value}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${m.color}`}
                          style={{ width: `${Math.min(m.inverted ? 100 - m.value : m.value, 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {m.inverted ? `Target: below ${m.target}%` : `Target: above ${m.target}%`}
                      </p>
                    </div>
                  ))}

                  {stats.bounceRate > 2 && (
                    <div className="flex items-start gap-2 text-xs text-yellow-600 bg-yellow-500/5 border border-yellow-500/20 rounded-md p-2.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Bounce rate is above 2%. Google/Yahoo flag senders above this threshold. Clean your prospect lists.</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Campaigns Tab */}
          <TabsContent value="campaigns" className="space-y-6">
            {campaignBreakdown.length > 0 && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Campaign Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={campaignBreakdown.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="name" className="text-xs" angle={-20} textAnchor="end" height={60} />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="sent" fill={STATUS_COLORS.sent} name="Sent" />
                        <Bar dataKey="opened" fill={STATUS_COLORS.opened} name="Opened" />
                        <Bar dataKey="replied" fill={STATUS_COLORS.replied} name="Replied" />
                        <Bar dataKey="bounced" fill={STATUS_COLORS.bounced} name="Bounced" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Campaign Details</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign</TableHead>
                          <TableHead className="text-center">Sent</TableHead>
                          <TableHead className="text-center">Opened</TableHead>
                          <TableHead className="text-center">Clicked</TableHead>
                          <TableHead className="text-center">Replied</TableHead>
                          <TableHead className="text-center">Bounced</TableHead>
                          <TableHead className="text-center">Open %</TableHead>
                          <TableHead className="text-center">Reply %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaignBreakdown.map((c: any) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium max-w-[200px] truncate">{c.name}</TableCell>
                            <TableCell className="text-center">{c.sent}</TableCell>
                            <TableCell className="text-center">{c.opened}</TableCell>
                            <TableCell className="text-center">{c.clicked}</TableCell>
                            <TableCell className="text-center">{c.replied}</TableCell>
                            <TableCell className="text-center">{c.bounced}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs">
                                {c.sent > 0 ? ((c.opened / c.sent) * 100).toFixed(0) : 0}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs text-purple-600">
                                {c.sent > 0 ? ((c.replied / c.sent) * 100).toFixed(0) : 0}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}

            {campaignBreakdown.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No campaign data available. Run a campaign to see performance here.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Prospects Tab */}
          <TabsContent value="prospects">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Per-Prospect Email Status</CardTitle>
                <CardDescription>Every email sent and its current engagement status</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prospect</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead>Replied</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 100).map((log: any) => {
                      const eventStatus = getEventStatus(log);
                      const badge = STATUS_BADGE[eventStatus] || { label: eventStatus, className: "bg-gray-400 text-white" };
                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">
                                {log.customers?.first_name
                                  ? `${log.customers.first_name} ${log.customers.last_name || ""}`.trim()
                                  : log.customer_name || log.customer_email || "—"
                                }
                              </p>
                              <p className="text-xs text-muted-foreground">{log.customer_email || log.customers?.email}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{log.customers?.firm_name || "—"}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{log.subject || "—"}</TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {log.sent_at ? format(new Date(log.sent_at), "MMM d, h:mm a") : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.opened_at ? (
                              <span className="text-green-600">{format(new Date(log.opened_at), "MMM d, h:mm a")}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.replied_at ? (
                              <span className="text-purple-600">{format(new Date(log.replied_at), "MMM d, h:mm a")}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredLogs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No prospect data for this filter
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Log Tab */}
          <TabsContent value="activity">
            <div className="space-y-4">
              {/* Research Sources */}
              {(researchLogs || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Research Sources</CardTitle>
                    <CardDescription>Pages and sources used during prospect research</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5">
                      {(researchLogs || []).filter((r: any) => r.detail?.url).slice(0, 50).map((log: any) => {
                        const STEP_COLORS: Record<string, string> = {
                          prospect_harvester: "#3b82f6",
                          source_discovery: "#8b5cf6",
                          research_summary: "#10b981",
                          qualification: "#f59e0b",
                          icp_interpreter: "#06b6d4",
                        };
                        const STEP_LABELS: Record<string, string> = {
                          prospect_harvester: "Research",
                          source_discovery: "Discovery",
                          research_summary: "Summary",
                          qualification: "Qualify",
                          icp_interpreter: "ICP",
                        };
                        return (
                          <div key={log.id} className="flex items-center justify-between py-2.5 px-3 border-b last:border-b-0 hover:bg-muted/30 rounded">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STEP_COLORS[log.step] || "#999" }} />
                              <div className="min-w-0">
                                <a
                                  href={log.detail.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block"
                                >
                                  {log.detail.title || log.detail.url}
                                  <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                                </a>
                                <p className="text-xs text-muted-foreground truncate">
                                  {log.detail.purpose || log.message}
                                  {log.detail.emails_found != null && ` — ${log.detail.emails_found} email${log.detail.emails_found !== 1 ? "s" : ""} found`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <Badge className="text-[10px] bg-muted text-muted-foreground">{STEP_LABELS[log.step] || log.step}</Badge>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {format(new Date(log.created_at), "MMM d, h:mm a")}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Email Activity */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Recent Email Activity</CardTitle>
                  <CardDescription>Real-time feed of all email events</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {filteredLogs.slice(0, 50).map((log: any) => {
                      const eventStatus = getEventStatus(log);
                      const badge = STATUS_BADGE[eventStatus] || { label: eventStatus, className: "bg-gray-400 text-white" };
                      const name = log.customers?.first_name
                        ? `${log.customers.first_name} ${log.customers.last_name || ""}`.trim()
                        : log.customer_name || log.customer_email || "Unknown";

                      return (
                        <div key={log.id} className="flex items-center justify-between py-2.5 px-3 border-b last:border-b-0 hover:bg-muted/30 rounded">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-2 h-2 rounded-full shrink-0`} style={{ backgroundColor: STATUS_COLORS[eventStatus] || "#999" }} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{name}</p>
                              <p className="text-xs text-muted-foreground truncate">{log.subject || "No subject"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <Badge className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(log.created_at), "MMM d, h:mm a")}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {filteredLogs.length === 0 && (
                      <div className="py-12 text-center text-muted-foreground">
                        <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No activity for the selected period</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
