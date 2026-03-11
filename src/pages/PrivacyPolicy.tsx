import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

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
        </div>
      </nav>

      {/* Content */}
      <article className="max-w-3xl mx-auto px-6 py-16 md:py-24">
        <div className="text-center mb-12">
          <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-3">Mora</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">Email Platform for Founders</p>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-muted-foreground leading-relaxed">
          <p>
            This Privacy Policy explains how Mora ("Mora," "we," "us," or "our") collects, uses, and protects information when you access or use the Mora email outreach platform and related services (the "Service").
          </p>
          <p>
            By using the Service, you agree to the practices described in this Privacy Policy.
          </p>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">1. Information We Collect</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">1.1 Account Information</h3>
            <p>When you create an account, we may collect information such as:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Name</li>
              <li>Email address</li>
              <li>Company name</li>
              <li>Account credentials</li>
              <li>Billing information</li>
            </ul>
            <p className="mt-3">Payment information is processed by third-party payment processors (such as Stripe). Mora does not store full payment card information.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">1.2 Usage Information</h3>
            <p>We may collect information about how users interact with the Service, including:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Login activity</li>
              <li>Feature usage</li>
              <li>Campaign activity</li>
              <li>System logs and diagnostics</li>
            </ul>
            <p className="mt-3">This information helps us operate and improve the Service.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">1.3 Outreach and Contact Data</h3>
            <p>Users may upload or generate prospect information within the platform, including:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Names</li>
              <li>Business email addresses</li>
              <li>Company information</li>
              <li>Outreach campaign data</li>
            </ul>
            <p className="mt-3">This information is referred to as User Data.</p>
            <p>Users are responsible for ensuring they have the right to process and use such data.</p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">2. How We Use Information</h2>
            <p>Mora uses collected information to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Provide and operate the Service</li>
              <li>Process subscriptions and payments</li>
              <li>Maintain platform functionality and security</li>
              <li>Improve features and user experience</li>
              <li>Communicate with users regarding updates or support</li>
            </ul>
            <p className="mt-3">We do not sell personal data to third parties.</p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">3. Data Processing</h2>
            <p>Users retain ownership of the data they upload to the platform.</p>
            <p>Mora processes user data solely for the purpose of:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Providing the Service</li>
              <li>Maintaining system reliability and security</li>
              <li>Improving platform functionality</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">4. Data Security</h2>
            <p>Mora uses commercially reasonable administrative and technical safeguards designed to protect user data.</p>
            <p>However, no method of internet transmission or storage is completely secure, and we cannot guarantee absolute security.</p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">5. Third-Party Services</h2>
            <p>The Service may rely on third-party providers for infrastructure, payment processing, email delivery, and analytics.</p>
            <p>These providers may process limited data necessary to operate the Service.</p>
            <p>Examples may include:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Cloud infrastructure providers</li>
              <li>Payment processors</li>
              <li>Email delivery providers</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">6. Data Retention</h2>
            <p>We retain user data only as long as necessary to provide the Service or comply with legal obligations.</p>
            <p>Upon account termination, Mora may delete or anonymize stored data after a reasonable retention period.</p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">7. User Responsibilities</h2>
            <p>Users are responsible for ensuring their use of the Service complies with applicable privacy and data protection laws, including regulations governing the use of contact data for outreach.</p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">8. Changes to This Policy</h2>
            <p>Mora may update this Privacy Policy periodically.</p>
            <p>If updates occur, the revised policy will be posted with an updated effective date.</p>
            <p>Continued use of the Service after changes constitutes acceptance of the updated policy.</p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">9. Contact</h2>
            <p>Questions regarding this Privacy Policy may be directed to:</p>
            <p className="font-medium text-foreground">support@mora.software</p>
          </section>

          {/* Email Compliance */}
          <section className="border-t border-border/40 pt-8 mt-12">
            <h2 className="text-xl font-bold text-foreground tracking-tight mb-4">Email and Outreach Compliance</h2>
            <p>Users of the Service are solely responsible for ensuring that all communications sent through the platform comply with applicable laws and regulations, including but not limited to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The CAN-SPAM Act</li>
              <li>GDPR where applicable</li>
              <li>Other anti-spam or privacy laws</li>
            </ul>
            <p className="mt-3">Mora provides tools to facilitate outreach but does not review, monitor, or approve individual email campaigns.</p>
            <p>Users agree not to use the Service to send unlawful, deceptive, or unsolicited bulk communications that violate applicable regulations.</p>
            <p>Any legal responsibility arising from outreach campaigns remains solely with the user.</p>
          </section>

          {/* Recurring Billing */}
          <section className="border-t border-border/40 pt-8 mt-12">
            <h2 className="text-xl font-bold text-foreground tracking-tight mb-4">Recurring Billing Authorization</h2>
            <p>By subscribing to a paid plan, you authorize Mora and its payment processor to charge your selected payment method on a recurring basis according to your selected billing cycle.</p>
            <p>Subscriptions automatically renew unless canceled before the next billing date.</p>
            <p>You may cancel your subscription at any time through your account settings.</p>
          </section>
        </div>
      </article>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <img src="/mora-logo-black.png" alt="Mora" className="h-6 w-6 object-contain block dark:hidden" />
            <img src="/mora-logo-white.png" alt="Mora" className="h-6 w-6 object-contain hidden dark:block" />
            <span className="font-medium">Mora</span>
          </div>
          <span>&copy; {new Date().getFullYear()} Mora. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
