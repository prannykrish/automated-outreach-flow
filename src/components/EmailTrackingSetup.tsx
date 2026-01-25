import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateResendConfig } from "@/lib/resend";

export function EmailTrackingSetup() {
  const [testEmail, setTestEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const { toast } = useToast();

  // Validate Resend configuration
  const config = validateResendConfig();

  // Test sending email
  const testSendMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/test-send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail }),
      });

      if (!response.ok) {
        throw new Error("Failed to send test email");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Test email sent!",
        description: "Check your inbox. When you open it, the tracking should update.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to send test email",
        description: "Check your Resend API key and configuration.",
        variant: "destructive",
      });
    },
  });

  // Test webhook delivery
  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      if (!webhookUrl) throw new Error("Please enter a webhook URL");

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email.opened",
          email: { id: "test-resend-id-12345" },
          created_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook test failed with status ${response.status}`);
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Webhook test successful!",
        description: "Your webhook URL is reachable and working.",
      });
    },
    onError: (error) => {
      toast({
        title: "Webhook test failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Email Tracking Setup</CardTitle>
          <CardDescription>Configure Resend webhooks to track opens and replies</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Configuration Status */}
          <div className="space-y-3">
            <h3 className="font-semibold">Configuration Status</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {config.valid ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                )}
                <span>Resend API Configuration</span>
                <Badge variant={config.valid ? "default" : "destructive"}>
                  {config.valid ? "✓ Configured" : "✗ Missing"}
                </Badge>
              </div>
              {!config.valid && (
                <p className="text-sm text-muted-foreground ml-7">{config.message}</p>
              )}
            </div>
          </div>

          {config.valid && (
            <>
              {/* Test Email */}
              <div className="space-y-3">
                <h3 className="font-semibold">Test Email Sending</h3>
                <p className="text-sm text-muted-foreground">
                  Send a test email to verify your Resend API key is working correctly.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Enter test email address"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                  <Button
                    onClick={() => testSendMutation.mutate()}
                    disabled={!testEmail || testSendMutation.isPending}
                    variant="outline"
                  >
                    {testSendMutation.isPending ? "Sending..." : "Send Test"}
                  </Button>
                </div>
              </div>

              {/* Webhook Setup */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-semibold">Webhook Configuration</h3>
                <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Step 1: Deploy Edge Function
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Run this command in your terminal:
                  </p>
                  <code className="block bg-background p-2 rounded border text-xs overflow-x-auto">
                    supabase functions deploy handle-resend-webhooks
                  </code>
                </div>

                <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm font-medium">Step 2: Enter Your Webhook URL</p>
                  <p className="text-sm text-muted-foreground">
                    After deploying, you'll get a URL. Paste it below:
                  </p>
                  <Input
                    placeholder="https://your-project.supabase.co/functions/v1/handle-resend-webhooks"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Step 3: Test Webhook</p>
                  <Button
                    onClick={() => testWebhookMutation.mutate()}
                    disabled={!webhookUrl || testWebhookMutation.isPending}
                    variant="outline"
                    className="w-full"
                  >
                    {testWebhookMutation.isPending ? "Testing..." : "Test Webhook"}
                  </Button>
                </div>

                <div className="space-y-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                  <p className="text-sm font-medium">Step 4: Add to Resend Dashboard</p>
                  <ol className="text-sm text-muted-foreground space-y-1 ml-4 list-decimal">
                    <li>Go to <a href="https://dashboard.resend.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Resend Dashboard</a></li>
                    <li>Navigate to Webhooks</li>
                    <li>Click "Add Webhook"</li>
                    <li>Paste your webhook URL</li>
                    <li>Select: delivered, opened, clicked, replied, bounced, complained</li>
                    <li>Save</li>
                  </ol>
                </div>
              </div>

              {/* What Gets Tracked */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-semibold">What Gets Tracked</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-2 bg-muted rounded">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">Email Opened</p>
                      <p className="text-muted-foreground">Updates `opened_at` timestamp</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-muted rounded">
                    <CheckCircle className="h-4 w-4 text-purple-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">Email Replied</p>
                      <p className="text-muted-foreground">Updates `replied_at` timestamp</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-muted rounded">
                    <CheckCircle className="h-4 w-4 text-red-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium">Email Failed</p>
                      <p className="text-muted-foreground">Updates status to "failed" on bounce/complaint</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Documentation Link */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Need Help?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            See the full setup guide for troubleshooting and advanced configuration:
          </p>
          <a
            href="https://github.com/yourusername/automated-outreach-flow/blob/main/WEBHOOK_SETUP.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline text-sm font-medium"
          >
            View WEBHOOK_SETUP.md Documentation →
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
