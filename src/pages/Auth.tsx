import React, { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Building2, MailCheck, Loader2, Check, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [mode, setMode] = useState<"signin" | "signup">(inviteToken ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState("");
  const { signIn, signUp } = useAuth();
  const nav = useNavigate();

  // Invite details
  const [inviteOrgName, setInviteOrgName] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Fetch invite details on mount
  useEffect(() => {
    if (!inviteToken) return;
    const fetchInvite = async () => {
      const { data, error } = await supabase.rpc("get_invitation_details", {
        invite_token: inviteToken,
      });
      if (error || !data || data.length === 0) {
        setInviteError("This invitation link is invalid. Please ask your admin to send a new one.");
        return;
      }
      const invite = data[0];
      if (invite.invite_status === "accepted") {
        setInviteOrgName(invite.organization_name);
        setInviteError("This invitation has already been accepted. Sign in to access your account.");
        return;
      }
      if (invite.invite_status === "expired") {
        setInviteError("This invitation has expired. Please ask your admin to send a new one.");
        return;
      }
      setInviteOrgName(invite.organization_name);
      setEmail(invite.invited_email);
    };
    fetchInvite();
  }, [inviteToken]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address");
      setLoading(false);
      return;
    }
    if (mode === "signup") {
      const domain = email.split("@")[1]?.toLowerCase();
      const disposable = [
        "guerrillamail.com","mailinator.com","tempmail.com","10minutemail.com",
        "dispostable.com","yopmail.com","throwaway.email","sharklasers.com",
        "guerrillamail.info","grr.la","guerrillamailblock.com","tempail.com",
        "fakeinbox.com","mailnesia.com","maildrop.cc","discard.email",
        "trashmail.com","trashmail.me","mohmal.com","getnada.com",
        "temp-mail.org","emailondeck.com","guerrillamail.net","guerrillamail.de",
        "mailcatch.com","throwam.com","tmail.ws","tmpmail.net",
        "bupmail.com","tempmailo.com",
      ];
      if (disposable.includes(domain)) {
        setError("Please use a non-disposable email address.");
        setLoading(false);
        return;
      }
    }
    if (!password) {
      setError("Please enter your password");
      setLoading(false);
      return;
    }
    if (mode === "signup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        setLoading(false);
        return;
      }
      if (!/[A-Z]/.test(password)) {
        setError("Password must include an uppercase letter");
        setLoading(false);
        return;
      }
      if (!/[a-z]/.test(password)) {
        setError("Password must include a lowercase letter");
        setLoading(false);
        return;
      }
      if (!/[0-9]/.test(password)) {
        setError("Password must include a number");
        setLoading(false);
        return;
      }
      if (!/[^A-Za-z0-9]/.test(password)) {
        setError("Password must include a special character");
        setLoading(false);
        return;
      }
    }

    // Normalize email: strip "+" aliases (e.g. user+1@gmail.com → user@gmail.com)
    // This prevents abuse via infinite Gmail aliases
    const normalizeEmail = (raw: string) => {
      const [local, domain] = raw.toLowerCase().trim().split("@");
      if (!local || !domain) return raw.toLowerCase().trim();
      const stripped = local.split("+")[0];
      return `${stripped}@${domain}`;
    };
    const normalizedEmail = mode === "signup" ? normalizeEmail(email) : email;

    try {
      // Store invite token so AuthContext can accept it during fetchOrganization
      if (inviteToken) {
        sessionStorage.setItem("pending_invite_token", inviteToken);
      }

      if (mode === "signin") {
        const res = await signIn(email, password);
        if (res.error) throw res.error;
      } else {
        const res = await signUp(normalizedEmail, password, { first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim() });
        if (res.error) throw res.error;

        // If Supabase email confirmation is enabled, user is returned but no session
        if (res.data?.user && !res.data?.session) {
          setConfirmEmail(true);
          setLoading(false);
          return;
        }
      }

      // Navigation happens automatically via RequireAuth once AuthContext resolves the org
      nav(inviteToken ? "/templates" : "/pipeline");
    } catch (err: any) {
      // Clear the token if auth failed
      if (inviteToken) sessionStorage.removeItem("pending_invite_token");

      // If email isn't confirmed yet, show OTP screen and resend the code
      if (err.message?.toLowerCase().includes("email not confirmed")) {
        try {
          await supabase.auth.resend({ type: "signup", email });
        } catch (_) { /* ignore resend errors */ }
        setConfirmEmail(true);
        setLoading(false);
        return;
      }

      setError(err.message === "Invalid login credentials" ? "Incorrect email or password" : err.message || "Authentication error");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) return;
    setVerifyingOtp(true);
    setOtpError("");
    try {
      const normalizedEmail = (() => {
        const [local, domain] = email.toLowerCase().trim().split("@");
        if (!local || !domain) return email.toLowerCase().trim();
        return `${local.split("+")[0]}@${domain}`;
      })();
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otpCode,
        type: "email",
      });
      if (error) throw error;
      if (data?.session) {
        nav(inviteToken ? "/templates" : "/pipeline");
      }
    } catch (err: any) {
      setOtpError(err.message || "Invalid verification code");
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpError("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      setOtpError(""); // clear any previous error
    } catch (err: any) {
      setOtpError(err.message || "Failed to resend code");
    }
  };

  if (confirmEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <MailCheck className="h-16 w-16 mx-auto text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Verify your email</h1>
            <p className="text-muted-foreground mt-2">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it below to verify your account.
            </p>
          </div>
          <div className="flex justify-center">
            <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {otpError && (
            <p className="text-sm text-red-500">{otpError}</p>
          )}
          <Button
            className="w-full"
            onClick={handleVerifyOtp}
            disabled={otpCode.length < 6 || verifyingOtp}
          >
            {verifyingOtp ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Verify
          </Button>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleResendOtp}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Didn't get a code? Resend
            </button>
            <Button variant="outline" size="sm" onClick={() => { setConfirmEmail(false); setOtpCode(""); setOtpError(""); setMode("signin"); }}>
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Back to website
          </Link>
        </div>

        {/* Invite banner */}
        {inviteToken && inviteOrgName && (
          <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium">You've been invited to join</p>
              <p className="text-base font-bold">{inviteOrgName}</p>
            </div>
          </div>
        )}

        {inviteToken && inviteError && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{inviteError}</p>
          </div>
        )}

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Welcome to Mora</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {inviteToken && inviteOrgName
              ? (mode === "signin" ? "Sign in to accept your invitation" : "Create an account to get started")
              : (mode === "signin" ? "Sign in to your account" : "Create a new account")}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
              </div>

              {mode === "signup" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium">First name</label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} type="text" placeholder="John" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium">Last name</label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} type="text" placeholder="Doe" />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium">Password</label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" />
              </div>

              {mode === "signup" && password.length > 0 && (
                <div className="space-y-1 text-xs">
                  {[
                    { met: password.length >= 8, label: "At least 8 characters" },
                    { met: /[A-Z]/.test(password), label: "Uppercase letter" },
                    { met: /[a-z]/.test(password), label: "Lowercase letter" },
                    { met: /[0-9]/.test(password), label: "Number" },
                    { met: /[^A-Za-z0-9]/.test(password), label: "Special character (!@#$...)" },
                  ].map((req) => (
                    <div key={req.label} className="flex items-center gap-1.5">
                      {req.met ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <X className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      <span className={req.met ? "text-green-500" : "text-muted-foreground/50"}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {mode === "signup" && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="terms"
                    checked={agreedToTerms}
                    onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="terms" className="text-sm text-muted-foreground leading-snug">
                    I agree to the{" "}
                    <Link to="/terms" target="_blank" className="underline hover:text-foreground">Terms of Service</Link>
                    {" "}and{" "}
                    <Link to="/privacy" target="_blank" className="underline hover:text-foreground">Privacy Policy</Link>
                  </label>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <Button type="submit" disabled={loading || (mode === "signup" && (!agreedToTerms || !email || !firstName || !lastName || password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)))} className="w-full">
                {loading ? "Loading..." : mode === "signin" ? "Sign In" : "Sign Up"}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === "signin" ? "Don't have an account? Create one" : "Already have an account? Sign in"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logo */}
      <div className="fixed bottom-4 right-4">
        <img src="/mora-logo-black.png" alt="Mora logo" className="h-8 w-8 object-contain block dark:hidden opacity-50" />
        <img src="/mora-logo-white.png" alt="Mora logo" className="h-8 w-8 object-contain hidden dark:block opacity-50" />
      </div>
    </div>
  );
}
