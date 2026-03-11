import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LandingFeatures from "@/components/LandingFeatures";
import LandingPricing from "@/components/LandingPricing";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border/40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/mora-logo-black.png" alt="Mora" className="h-8 w-8 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora" className="h-8 w-8 object-contain hidden dark:block" />
            <span className="text-lg font-semibold tracking-tight">Mora</span>
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
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-28 md:pt-32 md:pb-36 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.1]">
          The Email Platform
          <br />
          for <span className="text-muted-foreground/50">Founders.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Personalized sequences, delivered from your domain, on autopilot.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/auth">
            <Button size="lg">Start free trial</Button>
          </Link>
          <a href="#features">
            <Button variant="ghost" size="lg" className="text-muted-foreground">Learn more</Button>
          </a>
        </div>
      </section>

      {/* Features */}
      <LandingFeatures />

      {/* How it works */}
      <section id="how" className="border-t border-border/40">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <div className="text-center mb-16">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Three steps. Fully automated.</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
              <span className="text-4xl font-bold text-muted-foreground/15 block leading-none mb-4">01</span>
              <h3 className="text-lg font-semibold mb-2">Connect your domain.</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Verify SPF, DKIM, and DMARC in-app. Takes under five minutes.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
              <span className="text-4xl font-bold text-muted-foreground/15 block leading-none mb-4">02</span>
              <h3 className="text-lg font-semibold mb-2">Build your sequences.</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create templates with placeholders, set timing and delays.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
              <span className="text-4xl font-bold text-muted-foreground/15 block leading-none mb-4">03</span>
              <h3 className="text-lg font-semibold mb-2">Let Mora send.</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Import prospects or let the agent find them. Replies land in your Mora inbox.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <LandingPricing />

      {/* CTA */}
      <section className="border-t border-border/40 bg-muted/30">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32 text-center">
          <img src="/mora-logo-black.png" alt="Mora" className="h-12 w-12 object-contain mx-auto mb-8 block dark:hidden" />
          <img src="/mora-logo-white.png" alt="Mora" className="h-12 w-12 object-contain mx-auto mb-8 hidden dark:block" />
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Ready to automate your outreach?</h2>
          <p className="mt-4 text-muted-foreground max-w-md mx-auto">
            Join founders using Mora to send personalized sequences at scale.
          </p>
          <div className="mt-8">
            <Link to="/auth">
              <Button size="lg">Sign Up Free</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <img src="/mora-logo-black.png" alt="Mora" className="h-6 w-6 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora" className="h-6 w-6 object-contain hidden dark:block" />
            <span className="font-medium">Mora</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <span>&copy; {new Date().getFullYear()} Mora. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
