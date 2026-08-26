import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Detached card — rounded-2xl, hairline, lift shadow. */
export const cardClassName =
  "rounded-2xl border border-border bg-card text-card-foreground shadow-card";

/** Nested instrument tile (metrics, inset rows). */
export const tileClassName = "rounded-xl border border-border bg-muted";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardClassName, className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-0", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
