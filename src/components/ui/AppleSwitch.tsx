export function AppleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`button-press relative h-[31px] w-[51px] rounded-full transition ${
        checked ? "bg-[#34c759]" : "bg-[#e9e9eb]"
      }`}
    >
      <span
        className={`absolute top-0.5 size-[27px] rounded-full bg-white shadow-[0_2px_7px_rgba(0,0,0,0.22)] transition ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
