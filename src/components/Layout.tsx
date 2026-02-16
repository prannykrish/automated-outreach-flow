import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Sun, Moon, LogOut, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface LayoutProps {
  children: React.ReactNode;
}

function TrialBanner() {
  const { organizationId } = useAuth();

  const { data: org } = useQuery({
    queryKey: ["trial-banner-org", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("plan, billing_status, trial_ends_at")
        .eq("id", organizationId!)
        .single();
      return data;
    },
    enabled: !!organizationId,
  });

  if (!org || org.plan !== "trial") return null;

  const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  if (!trialEndsAt) return null;

  const now = new Date();
  const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const expired = daysLeft <= 0;

  if (daysLeft > 3 && !expired) return null;

  return (
    <div className={`px-4 py-2 text-sm flex items-center justify-center gap-2 ${expired ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"}`}>
      <AlertTriangle className="h-4 w-4" />
      {expired ? (
        <span>Your free trial has expired. <Link to="/billing" className="underline font-medium">Subscribe now</Link> to continue sending emails.</span>
      ) : (
        <span>Your free trial ends in {daysLeft} day{daysLeft !== 1 ? "s" : ""}. <Link to="/billing" className="underline font-medium">Subscribe now</Link></span>
      )}
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, signOut, profile } = useAuth();

  const UserInfo: React.FC = () => (
    <div className="flex items-center gap-3 pr-2">
      {user ? (
        <>
          <div className="text-sm text-muted-foreground">{profile?.name || profile?.first_name || user.email}</div>
          <Button variant="ghost" size="icon" onClick={() => signOut()} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">Not signed in</div>
      )}
    </div>
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <SidebarInset className="flex-1">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <div className="flex items-center gap-3">
              <UserInfo />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <Moon className="h-5 w-5" />
                ) : (
                  <Sun className="h-5 w-5" />
                )}
              </Button>
            </div>
          </header>
          <TrialBanner />
          <main className="flex-1 p-6 bg-background">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
