import type { ConnectionType } from "../../types";

const label: Record<ConnectionType, string> = {
  manual: "Вручную",
  internal: "Из события",
  verified: "Подтверждено",
};

const tone: Record<ConnectionType, string> = {
  manual: "border-white/74 bg-white/62 text-slate-600",
  internal: "border-white/74 bg-white/66 text-[#0087ff]",
  verified: "border-white/74 bg-white/66 text-emerald-600",
};

export function ConnectionBadge({ type }: { type: ConnectionType }) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-xl ${tone[type]}`}
    >
      <span className={`size-1.5 rounded-full ${type === "verified" ? "bg-emerald-500" : type === "internal" ? "bg-[#0087ff]" : "bg-slate-400"}`} />
      {label[type]}
    </span>
  );
}
