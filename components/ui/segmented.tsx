import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { id: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const index = options.findIndex((option) => option.id === value);
  return (
    <div
      data-slot="segmented"
      className={cn("flex h-10 min-h-10 flex-wrap items-center rounded-full bg-muted p-0.5", className)}
      style={{ "--i": index, "--n": options.length } as CSSProperties}
    >
      {/* Sliding Liquid Glass thumb — only rendered visibly by the iOS chrome. */}
      {index >= 0 && <span data-slot="segmented-indicator" aria-hidden />}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-slot="segmented-trigger"
          data-active={value === option.id}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            // min-w-0 keeps every segment exactly 1/n wide so the sliding thumb lines up.
            "flex h-full min-h-0 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-full px-1 py-0 text-[0.8125rem] font-medium leading-none min-[360px]:px-2 min-[400px]:text-sm",
            value === option.id ? "bg-secondary text-primary" : "text-muted-foreground",
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
