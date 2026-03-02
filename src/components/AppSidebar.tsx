import { Mail, GitBranch, UserPlus, BarChart3, LineChart, Settings, LogOut, Building, ShieldCheck, CreditCard, Inbox, Rocket } from "lucide-react";

import Logo from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { title: "Templates", url: "/templates", icon: Mail },
  { title: "Sequences", url: "/sequences", icon: GitBranch },
  { title: "Add Customers", url: "/customers", icon: UserPlus },
  { title: "Pipeline", url: "/pipeline", icon: BarChart3 },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Insights", url: "/insights", icon: LineChart },
  // { title: "Campaigns", url: "/agent", icon: Rocket },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { user, profile, signOut, organizationId } = useAuth();
  const isCollapsed = state === "collapsed";

  // Unread inbox count
  const { data: unreadCount } = useQuery({
    queryKey: ["inbox-unread", organizationId],
    queryFn: async () => {
      const { count } = await supabase
        .from("inbound_emails")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!)
        .eq("is_read", false);
      return count || 0;
    },
    enabled: !!organizationId,
    refetchInterval: 30000,
  });

  // Check if user is an admin of their organization
  const { data: membership } = useQuery({
    queryKey: ["my-membership", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, organizations(name)")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!user?.id,
  });

  // Check if user is a super admin
  const { data: isSuperAdmin } = useQuery({
    queryKey: ["is-super-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("users")
        .select("is_super_admin")
        .eq("id", user.id)
        .single();
      return data?.is_super_admin === true;
    },
    enabled: !!user?.id,
    
  });

  console.log("isSuperAdmin value:", isSuperAdmin);

  const isAdmin = membership?.role === "admin";
  const orgName = membership?.organizations?.name;

  const displayName = profile?.name || profile?.first_name || user?.email?.split("@")[0] || "User";
  const displayEmail = user?.email || "";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
  <div className={`flex items-center py-2 h-12 ${isCollapsed ? "px-2 justify-center" : "px-4"}`}>
    <img
      src="/mora-logo-black.png"
      alt="Mora logo"
      className={`object-contain block dark:hidden transition-all ${isCollapsed ? "h-8 w-8" : "h-10 w-10"}`}
    />
    <img
      src="/mora-logo-white.png"
      alt="Mora logo"
      className={`object-contain hidden dark:block transition-all ${isCollapsed ? "h-8 w-8" : "h-10 w-10"}`}
    />
  </div>
</SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      className="flex items-center gap-2"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.title === "Inbox" && !!unreadCount && unreadCount > 0 && (
                        <span className="ml-auto bg-primary text-primary-foreground text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Organization section - visible to org admins */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Organization">
                    <NavLink
                      to="/organization"
                      className="flex items-center gap-2"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                    >
                      <Building className="h-4 w-4" />
                      <span>Organization</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Billing">
                    <NavLink
                      to="/billing"
                      className="flex items-center gap-2"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>Billing</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Super Admin section - visible only to super admins */}
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Super Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Super Admin">
                    <NavLink
                      to="/super-admin"
                      className="flex items-center gap-2"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>Super Admin</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
      </SidebarContent>
      
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {/* Account dropdown */}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={displayEmail} className="cursor-pointer">
                  <div className="w-6 h-6 bg-primary/20 text-primary rounded-full flex items-center justify-center text-sm font-medium">
                    {initials}
                  </div>
                  {!isCollapsed && (
                    <div className="flex flex-col items-start overflow-hidden">
                      <span className="text-sm font-medium truncate">{displayName}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {orgName || displayEmail}
                      </span>
                    </div>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{displayEmail}</p>
                  {orgName && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {orgName} • {membership?.role === "admin" ? "Admin" : "Member"}
                    </p>
                  )}
                  {isSuperAdmin && (
                    <p className="text-xs text-primary mt-1 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Super Admin
                    </p>
                  )}
                </div>
                <DropdownMenuSeparator />
                {/* <DropdownMenuItem asChild>
                  <NavLink to="/settings" className="flex items-center gap-2 cursor-pointer">
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </NavLink>
                </DropdownMenuItem> */}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}