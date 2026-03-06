import { AlertTriangle } from "lucide-react";
import type { DomainWarmingStatus } from "@/hooks/useDomainWarming";

function ageLabel(days: number): string {
  if (days <= 1) return "less than a day old";
  if (days < 7) return `${days} days old`;
  if (days < 14) return "about 1 week old";
  if (days < 21) return "about 2 weeks old";
  if (days < 30) return "about 3 weeks old";
  if (days < 60) return "about 1 month old";
  return `${Math.floor(days / 30)} months old`;
}

export default function DomainWarmingBanner({ domains }: { domains: DomainWarmingStatus[] }) {
  const overLimit = domains.filter((d) => d.is_over_limit);
  if (overLimit.length === 0) return null;

  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-yellow-700 dark:text-yellow-300">Domain warming warning</p>
          {overLimit.map((d) => (
            <p key={d.domain} className="text-yellow-700/80 dark:text-yellow-300/80 mt-1">
              <span className="font-medium">{d.domain}</span> is {ageLabel(d.domain_age_days)}.
              You've sent {d.today_sent} email{d.today_sent !== 1 ? "s" : ""} today
              (recommended max: {d.recommended_limit} for this domain age).
            </p>
          ))}
          <p className="text-yellow-700/60 dark:text-yellow-300/60 mt-1.5">
            New domains need gradual ramp-up. Sending too fast can hurt your deliverability and land emails in spam.
          </p>
        </div>
      </div>
    </div>
  );
}
