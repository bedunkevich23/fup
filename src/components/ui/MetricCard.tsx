import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="glass-soft rounded-[22px] p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-white/64">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-[#1d1d1f]">{value}</p>
        </div>
        {icon ? (
          <div className="liquid-control flex size-10 items-center justify-center rounded-full text-[#0066cc]">
            {icon}
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-3 text-[12px] leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}
