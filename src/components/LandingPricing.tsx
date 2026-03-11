import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="8" className="fill-green-500/15" />
      <path d="M5 8.5L7 10.5L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-green-500" />
    </svg>
  );
}

export default function LandingPricing() {
  return (
    <section id="pricing" className="border-t border-border/40">
      <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-3">Pricing</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Simple, transparent pricing.</h2>
          <p className="mt-3 text-muted-foreground">
            Start with a 14-day free trial. No credit card required.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 max-w-3xl mx-auto">
          {/* Starter */}
          <Card>
            <CardHeader>
              <CardTitle>Starter</CardTitle>
              <CardDescription>For small teams getting started</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-bold">$19<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Check />1,000 emails / month</li>
                <li className="flex items-center gap-2"><Check />5 campaign runs / month</li>
                <li className="flex items-center gap-2"><Check />5 prospects per campaign</li>
                <li className="flex items-center gap-2"><Check />1 domain</li>
                <li className="flex items-center gap-2"><Check />2 sending emails</li>
                <li className="flex items-center gap-2"><Check />3 team members</li>
              </ul>
              <div className="pt-2">
                <Link to="/auth">
                  <Button variant="outline" className="w-full">Get Started</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Plus */}
          <Card className="border-primary relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground">Popular</Badge>
            </div>
            <CardHeader>
              <CardTitle>Plus</CardTitle>
              <CardDescription>For scaling teams</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-bold">$49<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Check />5,000 emails / month</li>
                <li className="flex items-center gap-2"><Check />20 campaign runs / month</li>
                <li className="flex items-center gap-2"><Check />5 prospects per campaign</li>
                <li className="flex items-center gap-2"><Check />3 domains</li>
                <li className="flex items-center gap-2"><Check />5 sending emails</li>
                <li className="flex items-center gap-2"><Check />10 team members</li>
              </ul>
              <div className="pt-2">
                <Link to="/auth">
                  <Button className="w-full">Get Started</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
