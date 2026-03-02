interface MoraIconProps {
  className?: string;
  /** Force a specific logo color instead of auto-detecting from theme. "invert" flips the theme logic. */
  variant?: "auto" | "white" | "black" | "invert";
}

export default function MoraIcon({ className = "h-5 w-5", variant = "auto" }: MoraIconProps) {
  if (variant === "white") {
    return <img src="/mora-logo-white.png" alt="Mora" className={`object-contain ${className}`} />;
  }
  if (variant === "black") {
    return <img src="/mora-logo-black.png" alt="Mora" className={`object-contain ${className}`} />;
  }
  if (variant === "invert") {
    return (
      <>
        <img src="/mora-logo-white.png" alt="Mora" className={`object-contain block dark:hidden ${className}`} />
        <img src="/mora-logo-black.png" alt="Mora" className={`object-contain hidden dark:block ${className}`} />
      </>
    );
  }
  return (
    <>
      <img
        src="/mora-logo-black.png"
        alt="Mora"
        className={`object-contain block dark:hidden ${className}`}
      />
      <img
        src="/mora-logo-white.png"
        alt="Mora"
        className={`object-contain hidden dark:block ${className}`}
      />
    </>
  );
}
