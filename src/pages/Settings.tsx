import { EmailTrackingSetup } from "@/components/EmailTrackingSetup";

export default function Settings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings & Configuration</h1>
        <p className="text-muted-foreground">Configure integrations and manage your application</p>
      </div>

      <EmailTrackingSetup />
    </div>
  );
}
