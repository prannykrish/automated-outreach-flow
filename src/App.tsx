import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Layout } from "@/components/Layout";
import Templates from "./pages/Templates";
import Sequences from "./pages/Sequences";
import Customers from "./pages/Customers";
import Pipeline from "./pages/Pipeline";
import Insights from "./pages/Insights";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import OrganizationPage from "@/pages/Organization";
import AuthPage from "./pages/Auth";
import Landing from "./pages/Landing";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AgentProvider } from "@/contexts/AgentContext";
import { CampaignAgentProvider } from "@/contexts/CampaignAgentContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { RequireAuth } from "@/components/RequireAuth";
import SuperAdmin from "@/pages/SuperAdmin";
import Billing from "./pages/Billing";
import Onboarding from "./pages/Onboarding";
import Agent from "./pages/Agent";
import Inbox from "./pages/Inbox";

function HomeRoute() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <RequireAuth><Layout><Navigate to="/templates" replace /></Layout></RequireAuth>;
  return <Landing />;
}

function OnboardingRoute() {
  const { user, loading, organizationId } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (organizationId) return <Navigate to="/templates" replace />;
  return <Onboarding />;
}


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AgentProvider>
            <CampaignAgentProvider>
            <OnboardingProvider>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/onboarding" element={<OnboardingRoute />} />

              <Route path="/" element={<HomeRoute />} />

              <Route
                path="/templates"
                element={
                  <RequireAuth>
                    <Layout>
                      <Templates />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/sequences"
                element={
                  <RequireAuth>
                    <Layout>
                      <Sequences />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/customers"
                element={
                  <RequireAuth>
                    <Layout>
                      <Customers />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/pipeline"
                element={
                  <RequireAuth>
                    <Layout>
                      <Pipeline />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/inbox"
                element={
                  <RequireAuth>
                    <Layout>
                      <Inbox />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/insights"
                element={
                  <RequireAuth>
                    <Layout>
                      <Insights />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <Layout>
                      <Settings />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/organization"
                element={
                  <RequireAuth>
                    <Layout>
                      <OrganizationPage />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
                path="/billing"
                element={
                  <RequireAuth>
                    <Layout>
                      <Billing />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route
  path="/super-admin"
  element={
    <RequireAuth>
      <Layout>
        <SuperAdmin />
      </Layout>
    </RequireAuth>
  }
/>

              <Route
                path="/agent"
                element={
                  <RequireAuth>
                    <Layout>
                      <Agent />
                    </Layout>
                  </RequireAuth>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
            </OnboardingProvider>
            </CampaignAgentProvider>
            </AgentProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
