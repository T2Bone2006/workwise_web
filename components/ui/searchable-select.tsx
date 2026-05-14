"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Command as CommandPrimitive } from "cmdk"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface SearchableSelectOption {
  value: string
  label: string
  group?: string
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select option",
  searchPlaceholder = "Search...",
  emptyText = "No options found.",
  className,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  )

  const filteredOptions = React.useMemo(() => {
    const query = normalize(search)
    if (!query) return options
    return options.filter((option) => {
      const label = normalize(option.label)
      const optionValue = normalize(option.value)
      const group = normalize(option.group ?? "")
      return (
        label.includes(query) ||
        optionValue.includes(query) ||
        group.includes(query)
      )
    })
  }, [options, search])

  const groupedOptions = React.useMemo(() => {
    const grouped = new Map<string, SearchableSelectOption[]>()
    for (const option of filteredOptions) {
      const key = option.group?.trim() || "__ungrouped__"
      const existing = grouped.get(key)
      if (existing) {
        existing.push(option)
      } else {
        grouped.set(key, [option])
      }
    }
    return Array.from(grouped.entries())
  }, [filteredOptions])

  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            !selectedOption && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className="line-clamp-1 flex items-center gap-2">
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <CommandPrimitive shouldFilter={false}>
          <CommandPrimitive.Input
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            className="border-border h-9 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <CommandPrimitive.List className="max-h-72 overflow-y-auto overflow-x-hidden p-1">
            <CommandPrimitive.Empty className="text-muted-foreground py-6 text-center text-sm">
              {emptyText}
            </CommandPrimitive.Empty>
            {groupedOptions.map(([group, groupItems]) => (
              <CommandPrimitive.Group
                key={group}
                heading={group === "__ungrouped__" ? undefined : group}
                className="text-foreground [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs"
              >
                {groupItems.map((option) => (
                  <CommandPrimitive.Item
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                    className="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none"
                  >
                    <span className="line-clamp-1 flex-1">{option.label}</span>
                    <CheckIcon
                      className={cn(
                        "absolute right-2 size-4",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
