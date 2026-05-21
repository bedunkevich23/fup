import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  soft = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; soft?: boolean }) {
  return (
    <div className={`${soft ? "glass-soft" : "glass"} rounded-[28px] ${className}`} {...props}>
      {children}
    </div>
  );
}
