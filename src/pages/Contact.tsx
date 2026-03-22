import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Send, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Contact() {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/enterprise-contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send");

      setSent(true);
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border/40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/mora-logo-black.png" alt="Mora" className="h-8 w-8 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora" className="h-8 w-8 object-contain hidden dark:block" />
            <span className="text-lg font-semibold tracking-tight">Mora</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-6 py-16 md:py-24">
        {sent ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <h2 className="text-xl font-semibold">Thanks for reaching out!</h2>
              <p className="text-muted-foreground text-center">
                We've received your inquiry and will get back to you shortly.
              </p>
              <Link to="/">
                <Button variant="outline">Back to Home</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Contact Us</CardTitle>
              <CardDescription>
                Interested in our Enterprise plan? Tell us about your needs and we'll get back to you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    placeholder="Company name"
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">How can we help?</Label>
                  <Textarea
                    id="message"
                    placeholder="Tell us about your outreach needs, team size, and what you're looking for..."
                    value={form.message}
                    onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                    className="min-h-[120px] resize-none"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={sending}>
                  {sending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send Message
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
