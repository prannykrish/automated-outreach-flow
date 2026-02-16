import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { signIn, signUp } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address");
      setLoading(false);
      return;
    }
    if (!password) {
      setError("Please enter your password");
      setLoading(false);
      return;
    }
    try {
      if (mode === "signin") {
        const res = await signIn(email, password);
        if (res.error) throw res.error;
      } else {
        const res = await signUp(email, password, { first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim() });
        if (res.error) throw res.error;
      }
      nav("/pipeline");
    } catch (err: any) {
      setError(err.message === "Invalid login credentials" ? "Incorrect email or password" : err.message || "Authentication error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Back to website
          </Link>
        </div>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Welcome to Mora</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Sign in to your account" : "Create a new account"}
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

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <Button type="submit" disabled={loading} className="w-full">
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
    </div>
  );
}
