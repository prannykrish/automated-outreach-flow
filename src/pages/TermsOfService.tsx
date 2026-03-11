import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function TermsOfService() {
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
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Terms of Service</h1>
          <p className="mt-3 text-sm text-muted-foreground">Email Platform for Founders</p>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-muted-foreground leading-relaxed">
          <p>
            These Terms of Service ("Agreement") govern access to and use of the Mora email outreach platform and related services (the "Service").
          </p>
          <p>
            This Agreement is entered into between the individual or organization accessing or using the Service ("Customer," "User," or "you") and Mora ("Mora," "we," or "us"), the operator of the Mora platform.
          </p>
          <p>
            By accessing or using the Service, creating an account, starting a free trial, purchasing a subscription, or otherwise agreeing to these terms through a click-through acceptance (such as selecting "I Agree"), you agree to be bound by this Agreement.
          </p>
          <p>
            The date you first accept these terms or use the Service is the "Effective Date."
          </p>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">1. Access to the Service</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">1.1 License Grant</h3>
            <p>Subject to compliance with this Agreement and payment of applicable fees, Mora grants you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service for your internal business purposes.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">1.2 Account Registration</h3>
            <p>To use the Service, you must create an account. You are responsible for maintaining the security of your account credentials and for all activity occurring under your account.</p>
            <p>You must provide accurate and complete information when creating an account.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">1.3 Free Trial</h3>
            <p>Mora may provide a free trial period allowing users to evaluate the Service. Free trials may include usage limits, feature restrictions, or expiration dates determined by Mora.</p>
            <p>Mora reserves the right to modify or terminate free trials at any time.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">1.4 Subscription Plans</h3>
            <p>Certain features of the Service require a paid subscription. Subscription details, including pricing and usage limits, will be presented during the checkout or billing process ("Order Details").</p>
            <p>Subscriptions automatically renew unless canceled prior to the next billing cycle.</p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">2. Service Features</h2>
            <p>The Service may include tools that enable users to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Create and manage email templates and sequences</li>
              <li>Send individual or bulk outreach campaigns</li>
              <li>Schedule email campaigns</li>
              <li>Manage prospect pipelines</li>
              <li>Verify domains and email addresses</li>
              <li>Use automated or AI-assisted prospect discovery tools</li>
            </ul>
            <p className="mt-3">Features may evolve over time, and Mora may add, modify, or discontinue features at its discretion.</p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">3. Acceptable Use</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">3.1 User Responsibility</h3>
            <p>You are responsible for how you use the Service and for all communications sent through the platform.</p>
            <p>You agree to comply with all applicable laws and regulations related to email communication, including anti-spam laws.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">3.2 Prohibited Conduct</h3>
            <p>You may not use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Send spam, unsolicited mass communications, or abusive messages</li>
              <li>Violate applicable anti-spam or privacy laws</li>
              <li>Impersonate another person or organization</li>
              <li>Distribute malicious software or harmful content</li>
              <li>Circumvent technical limits or access controls</li>
              <li>Reverse engineer, copy, scrape, or extract data from the Service</li>
              <li>Use the Service to build a competing product</li>
            </ul>
            <p className="mt-3">Mora may suspend or terminate accounts that violate these rules.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">3.3 Email Compliance</h3>
            <p>Users are solely responsible for ensuring their outreach campaigns comply with laws such as the CAN-SPAM Act, GDPR, and other applicable regulations.</p>
            <p>Mora provides tools to facilitate outreach but does not control or review individual messages sent by users.</p>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">4. Data & Privacy</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">4.1 User Data</h3>
            <p>You retain ownership of any data you submit to the Service, including contact lists, campaign content, and prospect information ("User Data").</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">4.2 Service Operation</h3>
            <p>You grant Mora the right to process User Data solely for the purpose of operating, maintaining, and improving the Service.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">4.3 Security</h3>
            <p>Mora uses commercially reasonable safeguards designed to protect user data from unauthorized access or disclosure.</p>
            <p>However, no internet service can be guaranteed to be completely secure.</p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">5. Payments & Billing</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">5.1 Payment Processing</h3>
            <p>Payments for subscriptions are processed through third-party payment providers such as Stripe.</p>
            <p>By purchasing a subscription, you authorize Mora and its payment processor to charge your designated payment method on a recurring basis.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">5.2 Billing Cycle</h3>
            <p>Subscriptions are billed in advance on a recurring monthly or annual basis depending on the selected plan.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">5.3 Nonpayment</h3>
            <p>Failure to pay subscription fees may result in suspension or termination of access to the Service.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">5.4 Refunds</h3>
            <p>Unless otherwise stated, subscription payments are non-refundable.</p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">6. Intellectual Property</h2>
            <p>The Service, including its software, design, branding, and functionality, is owned by Mora and protected by intellectual property laws.</p>
            <p>You may not reproduce, modify, distribute, or create derivative works of the Service without permission.</p>
            <p>All rights not expressly granted in this Agreement are reserved.</p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">7. Disclaimer of Warranties</h2>
            <p className="uppercase font-medium text-foreground text-xs tracking-wide">The Service is provided "as is" and "as available."</p>
            <p className="uppercase font-medium text-foreground text-xs tracking-wide mt-3">Mora disclaims all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
            <p className="mt-3">Mora does not guarantee that:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The Service will be uninterrupted or error-free</li>
              <li>Emails sent through the platform will reach recipients</li>
              <li>Outreach campaigns will receive responses or achieve results</li>
            </ul>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">8. Limitation of Liability</h2>
            <p className="uppercase font-medium text-foreground text-xs tracking-wide">To the maximum extent permitted by law, Mora shall not be liable for any indirect, incidental, special, consequential, or punitive damages.</p>
            <p className="uppercase font-medium text-foreground text-xs tracking-wide mt-3">Mora's total liability arising from this Agreement shall not exceed the amount paid by the user for the Service during the twelve (12) months preceding the claim.</p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">9. Indemnification</h2>
            <p>You agree to indemnify and hold harmless Mora from any claims, damages, liabilities, or expenses arising from:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your use of the Service</li>
              <li>Communications sent through the platform</li>
              <li>Your violation of applicable laws</li>
              <li>Your breach of this Agreement</li>
            </ul>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">10. Evolving Service</h2>
            <p>Mora is an evolving platform. Features, interfaces, and capabilities may change over time.</p>
            <p>We may update, modify, or discontinue parts of the Service without prior notice.</p>
          </section>

          {/* Section 11 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">11. Feedback</h2>
            <p>If you provide suggestions, ideas, or feedback about the Service, you grant Mora a perpetual, royalty-free license to use that feedback without obligation or compensation.</p>
          </section>

          {/* Section 12 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">12. Termination</h2>

            <h3 className="text-base font-semibold text-foreground mb-2">12.1 Termination by User</h3>
            <p>You may cancel your subscription at any time through your account settings.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">12.2 Termination by Mora</h3>
            <p>Mora may suspend or terminate access to the Service if you violate this Agreement or misuse the platform.</p>

            <h3 className="text-base font-semibold text-foreground mt-6 mb-2">12.3 Effect of Termination</h3>
            <p>Upon termination:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Access to the Service will end</li>
              <li>Outstanding fees remain payable</li>
              <li>Mora may delete user data after a reasonable retention period</li>
            </ul>
          </section>

          {/* Section 13 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">13. Governing Law</h2>
            <p>This Agreement is governed by the laws of the State of Texas, without regard to conflict-of-law principles.</p>
            <p>Any disputes arising from this Agreement shall be resolved in the state or federal courts located in Texas.</p>
          </section>

          {/* Section 14 */}
          <section>
            <h2 className="text-xl font-bold text-foreground tracking-tight mt-10 mb-4">14. Changes to These Terms</h2>
            <p>Mora may update these Terms of Service from time to time.</p>
            <p>If changes are made, the updated terms will be posted on the Mora website with a revised effective date.</p>
            <p>Continued use of the Service after updates constitutes acceptance of the revised terms.</p>
          </section>

          {/* Acceptance */}
          <section className="border-t border-border/40 pt-8 mt-12">
            <h2 className="text-xl font-bold text-foreground tracking-tight mb-4">Acceptance</h2>
            <p className="uppercase font-medium text-foreground text-xs tracking-wide">
              By creating an account, accessing the Service, starting a free trial, or purchasing a subscription, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
            </p>
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
