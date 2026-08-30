import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Chrome-aware surface: MY3 tonal tile, Fluent stroke, iOS island only when forced. */
export const cardClassName = "fb-card";

/** Nested instrument tile (metrics, inset rows). */
export const tileClassName = "fb-tile";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardClassName, className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-0", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
