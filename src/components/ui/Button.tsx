import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft";

const variants: Record<ButtonVariant, string> = {
  primary: "liquid-blue text-white hover:brightness-[1.04]",
  secondary: "liquid-control text-[#0066cc] hover:bg-white/70",
  ghost: "text-[#0066cc] hover:bg-white/48",
  soft: "liquid-control text-[#1d1d1f] hover:bg-white/70",
};

export function Button({
  children,
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <button
      className={`button-press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium outline-none ring-[#0071e3]/20 transition focus-visible:ring-4 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
