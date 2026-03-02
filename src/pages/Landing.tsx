import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GitBranch, Users, BarChart3, ArrowRight, Zap, Target, Send, CheckCircle } from "lucide-react";

const features = [
  {
    icon: GitBranch,
    title: "Smart Sequences",
    description: "Build multi-step email sequences with custom timing and delays. Set it up once and let it run.",
  },
  {
    icon: Zap,
    title: "Custom Placeholders",
    description: "Personalize every email with dynamic fields like industry, role, or anything else you need.",
  },
  {
    icon: Target,
    title: "Pipeline Tracking",
    description: "See every customer's journey through your outreach funnel in real time.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Share templates, customers, and insights across your entire organization.",
  },
];

const steps = [
  {
    number: "01",
    title: "Create Templates",
    description: "Write your emails with personalized placeholders that auto-fill for each recipient.",
  },
  {
    number: "02",
    title: "Build Sequences",
    description: "Arrange your templates into timed sequences with custom delays between each step.",
  },
  {
    number: "03",
    title: "Import & Send",
    description: "Add your customers manually or via CSV, and your outreach runs automatically.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border/50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/mora-logo-black.png" alt="Mora logo" className="h-8 w-8 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora logo" className="h-8 w-8 object-contain hidden dark:block" />
            <span className="text-lg font-semibold">Mora</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#pricing">
              <Button variant="ghost" size="sm">Pricing</Button>
            </a>
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 md:py-32 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          The Email Platform for
          <br />
          <span className="text-muted-foreground">Founders.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Mora helps you build personalized email sequences, manage your pipeline, and close more deals — all on autopilot.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/auth">
            <Button size="lg" className="gap-2">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <a href="#features">
            <Button variant="outline" size="lg">Learn More</Button>
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/50 bg-muted/30">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold">Everything you need to scale your outreach</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Stop sending emails one by one. Mora automates the entire process so you can focus on closing.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-6 rounded-xl border border-border/50 bg-card"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/50">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold">How it works</h2>
            <p className="mt-3 text-muted-foreground">Three steps to automated outreach.</p>
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="text-center md:text-left">
                <span className="text-4xl font-bold text-primary/20">{step.number}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border/50 bg-muted/30">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold">Simple, transparent pricing</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Start with a 14-day free trial. No credit card required.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 max-w-3xl mx-auto">
            {/* Starter */}
            <div className="p-6 rounded-xl border border-border/50 bg-card">
              <h3 className="text-lg font-semibold">Starter</h3>
              <p className="text-sm text-muted-foreground mt-1">For small teams</p>
              <p className="text-3xl font-bold mt-4">$19<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />1,000 emails / month</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />25 Mora AI messages / mo</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />1 domain</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />2 sending emails</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />3 team members</li>
              </ul>
              <Link to="/auth" className="block mt-6">
                <Button variant="outline" className="w-full">Get Started</Button>
              </Link>
            </div>

            {/* Plus */}
            <div className="p-6 rounded-xl border-2 border-primary bg-card relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                Popular
              </div>
              <h3 className="text-lg font-semibold">Plus</h3>
              <p className="text-sm text-muted-foreground mt-1">For scaling teams</p>
              <p className="text-3xl font-bold mt-4">$49<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />5,000 emails / month</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />200 Mora AI messages / mo</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />3 domains</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />5 sending emails</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />10 team members</li>
              </ul>
              <Link to="/auth" className="block mt-6">
                <Button className="w-full">Get Started</Button>
              </Link>
            </div>

            {/* Enterprise — commented out for now
            <div className="p-6 rounded-xl border border-border/50 bg-card">
              <h3 className="text-lg font-semibold">Enterprise</h3>
              <p className="text-sm text-muted-foreground mt-1">For large organizations</p>
              <p className="text-3xl font-bold mt-4">Custom</p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />Unlimited emails</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />Unlimited Mora AI</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />Custom domains</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />Unlimited members</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" />Dedicated support</li>
              </ul>
              <Button variant="outline" className="w-full mt-6" asChild>
                <a href="mailto:support@mora.app">Contact Us</a>
              </Button>
            </div>
            */}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/50">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-28 text-center">
          <Send className="h-10 w-10 mx-auto text-primary mb-6" />
          <h2 className="text-3xl font-bold">Ready to automate your outreach?</h2>
          <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
            Join teams using Mora to send personalized email sequences at scale.
          </p>
          <div className="mt-8">
            <Link to="/auth">
              <Button size="lg" className="gap-2">
                Sign Up Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/mora-logo-black.png" alt="Mora logo" className="h-6 w-6 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora logo" className="h-6 w-6 object-contain hidden dark:block" />
            <span className="font-medium">Mora</span>
          </div>
          <span>&copy; {new Date().getFullYear()} Mora. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
