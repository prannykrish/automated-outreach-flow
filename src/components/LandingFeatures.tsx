export default function LandingFeatures() {
  return (
    <section id="features" className="border-t border-border/40 bg-muted/30">
      <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-3">Features</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Everything you need to scale outreach.</h2>
        </div>

        {/* Feature cards grid */}
        <div className="grid md:grid-cols-2 gap-5">
          {/* Prospect Finding — spans full width */}
          <div className="md:col-span-2 rounded-xl border border-border/50 bg-card p-8 md:p-10">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">Prospects</p>
            <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
              Import your own, or let Mora find them.
            </h3>
            <p className="text-muted-foreground max-w-2xl leading-relaxed">
              Upload your prospects, or let our AI agent research to surface ideal contacts with evidence of why they're a fit, alongside a ready-to-send sequence or your custom templates.
            </p>
          </div>

          {/* Sequences */}
          <div className="rounded-xl border border-border/50 bg-card p-8">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">Sequences</p>
            <h3 className="text-xl font-bold tracking-tight mb-2">Multi-step email chains.</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Build timed sequences with custom delays. Personalize every message with your unique dynamic placeholders.
            </p>
          </div>

          {/* Inbox */}
          <div className="rounded-xl border border-border/50 bg-card p-8">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">Inbox</p>
            <h3 className="text-xl font-bold tracking-tight mb-2">Every reply, one place.</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A unified inbox that threads messages by contact. See opens, replies, and pick up conversations instantly.
            </p>
          </div>

          {/* Domain */}
          <div className="rounded-xl border border-border/50 bg-card p-8">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">Your Domain</p>
            <h3 className="text-xl font-bold tracking-tight mb-2">Send from your own email.</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect your domain, verify SPF, DKIM, and DMARC in-app, and send from any address at your company.
            </p>
          </div>

          {/* Pipeline */}
          <div className="rounded-xl border border-border/50 bg-card p-8">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">Pipeline</p>
            <h3 className="text-xl font-bold tracking-tight mb-2">Track every deal.</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              See your outreach funnel in real time: who's been contacted, who's engaged, and where to focus next.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
