import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft";

const variants: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-[#007aff] text-white shadow-[0_10px_22px_rgba(0,122,255,0.20)] hover:bg-[#006fe8]",
  secondary: "border border-transparent bg-white/72 text-[#007aff] shadow-[0_8px_18px_rgba(23,36,51,0.06)] backdrop-blur-xl hover:bg-white/88",
  ghost: "border border-transparent bg-white/52 text-[#5f6873] shadow-[0_8px_18px_rgba(23,36,51,0.04)] backdrop-blur-xl hover:bg-white/76",
  soft: "border border-transparent bg-[#eef6ff] text-[#007aff] shadow-none backdrop-blur-xl hover:bg-[#e4f1ff]",
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
      className={`button-press inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full px-5 text-center text-[14px] font-semibold leading-tight outline-none ring-[#0071e3]/20 transition focus-visible:ring-4 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
