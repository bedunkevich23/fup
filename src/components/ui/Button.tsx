import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft";

const variants: Record<ButtonVariant, string> = {
  primary: "border border-[#0087ff] bg-[#0087ff] text-white hover:bg-[#0077e6]",
  secondary: "border border-white/72 bg-white/68 text-[#0087ff] backdrop-blur-xl hover:bg-white/84",
  ghost: "text-[#6f7780] hover:bg-white/48",
  soft: "border border-[#0087ff]/18 bg-white/64 text-[#0066cc] backdrop-blur-xl hover:border-[#0087ff]/28 hover:bg-white/82",
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
      className={`button-press inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-center text-[14px] font-medium leading-tight shadow-none outline-none ring-[#0071e3]/20 transition focus-visible:ring-4 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
