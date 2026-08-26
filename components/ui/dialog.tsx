"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/70 backdrop-blur-sm", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-dock md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl",
        className,
      )}
      {...props}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted md:hidden" />
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogContent, DialogClose, DialogTitle, DialogPortal, DialogOverlay };
