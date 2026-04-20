import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "h-10 w-full min-w-0 rounded-lg border bg-white/80 px-3.5 py-2 text-base shadow-soft outline-none backdrop-blur-sm",
        "transition-all duration-300 ease-out",
        "border-input file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary/20 focus-visible:shadow-[var(--shadow-input-focus-value)]",
        "dark:bg-white/5 dark:backdrop-blur-md dark:border-white/10 dark:focus-visible:border-brand-primary dark:focus-visible:ring-brand-primary/30 dark:focus-visible:shadow-[var(--shadow-input-focus-value)]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
