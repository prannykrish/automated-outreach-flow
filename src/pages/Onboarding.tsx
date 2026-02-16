import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, Users, ArrowLeft, Loader2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Step = "choose" | "create" | "join" | "pending";

export default function Onboarding() {
  const { user, hasPendingRequest, refetchOrganization, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(hasPendingRequest ? "pending" : "choose");
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [foundOrg, setFoundOrg] = useState<{ id: string; name: string } | null>(null);
  const [pendingOrgName, setPendingOrgName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check for existing pending request on mount
  useEffect(() => {
    if (!user?.id) return;
    const checkPending = async () => {
      const { data } = await supabase
        .from("join_requests")
        .select("organization_id, organizations(name)")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (data) {
        setPendingOrgName((data as any).organizations?.name || "the organization");
        setStep("pending");
      }
    };
    if (hasPendingRequest) checkPending();
  }, [user?.id, hasPendingRequest]);

  const handleCreateOrg = async () => {
    if (!orgName.trim() || !user?.id) return;
    setIsSubmitting(true);
    try {
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: orgName.trim() })
        .select()
        .single();
      if (orgError) throw orgError;

      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          organization_id: org.id,
          user_id: user.id,
          role: "admin",
        });
      if (memberError) throw memberError;

      await refetchOrganization();
      toast({ title: "Organization created!" });
      navigate("/templates", { replace: true });
    } catch (err: any) {
      toast({ title: "Error creating organization", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLookupCode = async () => {
    if (!inviteCode.trim()) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("lookup_org_by_invite_code", {
        code: inviteCode.trim(),
      });
      if (error) throw error;
      if (!data || data.length === 0) {
        toast({ title: "Invalid invite code", description: "No organization found with that code.", variant: "destructive" });
        setFoundOrg(null);
      } else {
        setFoundOrg({ id: data[0].id, name: data[0].name });
      }
    } catch (err: any) {
      toast({ title: "Error looking up code", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!user?.id) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from("join_requests")
        .delete()
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (error) throw error;

      await refetchOrganization();
      setFoundOrg(null);
      setInviteCode("");
      setPendingOrgName("");
      setStep("choose");
      toast({ title: "Request cancelled" });
    } catch (err: any) {
      toast({ title: "Error cancelling request", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestJoin = async () => {
    if (!foundOrg || !user?.id) return;
    setIsSubmitting(true);
    try {
      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", foundOrg.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        await refetchOrganization();
        navigate("/templates", { replace: true });
        return;
      }

      // Check for existing request
      const { data: existingReq } = await supabase
        .from("join_requests")
        .select("id, status")
        .eq("organization_id", foundOrg.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingReq) {
        if (existingReq.status === "pending") {
          setPendingOrgName(foundOrg.name);
          setStep("pending");
          return;
        }
        if (existingReq.status === "rejected") {
          toast({ title: "Request previously declined", description: "Your request to join this organization was declined.", variant: "destructive" });
          return;
        }
      }

      // Create join request
      const { error: reqError } = await supabase
        .from("join_requests")
        .insert({
          user_id: user.id,
          organization_id: foundOrg.id,
        });
      if (reqError) throw reqError;

      await refetchOrganization();
      setPendingOrgName(foundOrg.name);
      setStep("pending");
      toast({ title: "Request sent!", description: `Your request to join ${foundOrg.name} has been submitted.` });
    } catch (err: any) {
      toast({ title: "Error sending request", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome to Mora</h1>
          <p className="text-muted-foreground mt-2">Get started by setting up your organization</p>
        </div>

        {step === "choose" && (
          <div className="grid gap-4">
            <Card
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setStep("create")}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Building2 className="h-6 w-6 text-primary" />
                  Create an Organization
                </CardTitle>
                <CardDescription>
                  Start a new organization and invite your team
                </CardDescription>
              </CardHeader>
            </Card>

            <Card
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setStep("join")}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-primary" />
                  Join an Organization
                </CardTitle>
                <CardDescription>
                  Enter an invite code to request access
                </CardDescription>
              </CardHeader>
            </Card>

            <Button variant="ghost" size="sm" className="mx-auto" onClick={signOut}>
              Sign out
            </Button>
          </div>
        )}

        {step === "create" && (
          <Card>
            <CardHeader>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit -ml-2 mb-2"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <CardTitle>Create Organization</CardTitle>
              <CardDescription>Choose a name for your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Organization name"
                onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
              />
              <Button
                className="w-full"
                onClick={handleCreateOrg}
                disabled={!orgName.trim() || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Create Organization
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "join" && (
          <Card>
            <CardHeader>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit -ml-2 mb-2"
                onClick={() => { setStep("choose"); setFoundOrg(null); setInviteCode(""); }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <CardTitle>Join Organization</CardTitle>
              <CardDescription>Enter the invite code shared by your admin</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!foundOrg ? (
                <>
                  <Input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="Enter invite code"
                    maxLength={8}
                    className="font-mono text-center text-lg tracking-widest"
                    onKeyDown={(e) => e.key === "Enter" && handleLookupCode()}
                  />
                  <Button
                    className="w-full"
                    onClick={handleLookupCode}
                    disabled={!inviteCode.trim() || isSubmitting}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Look Up
                  </Button>
                </>
              ) : (
                <>
                  <div className="border rounded-lg p-4 text-center">
                    <Building2 className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="font-semibold text-lg">{foundOrg.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">Request to join this organization?</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => { setFoundOrg(null); setInviteCode(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleRequestJoin}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Request to Join
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {step === "pending" && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h2 className="text-xl font-semibold">Request Pending</h2>
                <p className="text-muted-foreground mt-2">
                  Your request to join <strong>{pendingOrgName}</strong> is awaiting approval.
                  You'll receive an email once an admin reviews it.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelRequest}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Cancel Request
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
