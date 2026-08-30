import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div data-slot="segmented" className="flex h-10 min-h-10 flex-wrap items-center rounded-full bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-slot="segmented-trigger"
          data-active={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex h-full min-h-0 flex-1 items-center justify-center rounded-full px-3 py-0 text-sm font-medium leading-none",
            value === option.id ? "bg-secondary text-primary" : "text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
