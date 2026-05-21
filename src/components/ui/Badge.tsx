import type { ConnectionType } from "../../types";

const label: Record<ConnectionType, string> = {
  manual: "Вручную",
  internal: "Из программы",
  verified: "Подтверждено",
};

const tone: Record<ConnectionType, string> = {
  manual: "border-slate-200 bg-white/58 text-slate-600",
  internal: "border-sky-200 bg-sky-50/70 text-sky-700",
  verified: "border-emerald-200 bg-emerald-50/70 text-emerald-700",
};

export function ConnectionBadge({ type }: { type: ConnectionType }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone[type]}`}
    >
      {label[type]}
    </span>
  );
}
