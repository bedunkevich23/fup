import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const inputClass =
  "w-full min-h-[52px] rounded-[24px] border border-white/74 bg-white/62 px-4 py-3 text-[16px] text-[#1d1d1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-[#0066cc]/32 focus:bg-white/82 focus:ring-4 focus:ring-[#0066cc]/10";

export function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-slate-600">
        {label}
        {required ? <span aria-hidden className="ml-1 text-[#0087ff]">*</span> : null}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} min-h-[112px] resize-none`} {...props} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass} {...props} />;
}
