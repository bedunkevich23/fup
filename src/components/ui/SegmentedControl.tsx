import { hapticSelection } from "../../lib/telegram";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`liquid-control flex rounded-full p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            if (value !== option.value) hapticSelection();
            onChange(option.value);
          }}
          className={`button-press flex h-11 flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition ${
            value === option.value
              ? "bg-white/86 text-[#0066cc] shadow-[0_5px_16px_rgba(29,29,31,0.08)]"
              : "text-slate-500 hover:bg-white/34 hover:text-[#1d1d1f]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
