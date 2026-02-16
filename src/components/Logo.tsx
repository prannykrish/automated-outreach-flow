import React from "react";

type LogoProps = {
  className?: string;
  alt?: string;
};

export function Logo({ className = "h-6 w-6", alt = "Mora" }: LogoProps) {
  return (
    <span className={className} aria-hidden>
      {/* Light-mode (dark:hidden) shows dark logo image; Dark-mode (hidden dark:block) shows light logo image */}
      <img src="/logo-dark.png" alt={alt} className="block dark:hidden h-full w-full" />
      <img src="/logo-light.png" alt={alt} className="hidden dark:block h-full w-full" />
    </span>
  );
}

export default Logo;
