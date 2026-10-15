"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Command as CommandPrimitive } from "cmdk"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { SearchableSelectOption } from "@/components/ui/searchable-select"

interface SearchableMultiSelectProps {
  options: SearchableSelectOption[]
  values: string[]
  onValuesChange: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  /**
   * When the search text is not already an option, offer it as its own choice.
   * Used so a postcode area prefix (for example "SW") can be selected.
   */
  allowQueryValue?: boolean
  onOpenChange?: (open: boolean) => void
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

export function SearchableMultiSelect({
  options,
  values,
  onValuesChange,
  placeholder = "Select",
  searchPlaceholder = "Search...",
  emptyText = "No options found.",
  className,
  disabled,
  allowQueryValue = false,
  onOpenChange,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  const [search, setSearch] = React.useState("")

  const selected = React.useMemo(() => new Set(values), [values])

  const filteredOptions = React.useMemo(() => {
    const query = normalize(search)
    if (!query) return options
    return options.filter((option) => {
      const label = normalize(option.label)
      const optionValue = normalize(option.value)
      return label.includes(query) || optionValue.includes(query)
    })
  }, [options, search])

  const queryValue = search.trim().toUpperCase().replace(/\s+/g, " ")
  const showQueryChoice =
    allowQueryValue &&
    queryValue.length > 0 &&
    !options.some((option) => option.value.toUpperCase() === queryValue) &&
    !values.some((value) => value.toUpperCase() === queryValue)

  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const toggle = (value: string) => {
    if (selected.has(value)) {
      onValuesChange(values.filter((item) => item !== value))
    } else {
      onValuesChange([...values, value])
    }
  }

  const summary =
    values.length === 0
      ? placeholder
      : values.length <= 3
        ? values.join(", ")
        : `${values.slice(0, 2).join(", ")} +${values.length - 2}`

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            values.length === 0 && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className="line-clamp-1 flex-1 text-left">{summary}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0">
        <CommandPrimitive shouldFilter={false}>
          <CommandPrimitive.Input
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            className="border-border h-9 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <CommandPrimitive.List className="max-h-72 overflow-y-auto overflow-x-hidden p-1">
            {filteredOptions.length === 0 && !showQueryChoice ? (
              <CommandPrimitive.Empty className="text-muted-foreground py-6 text-center text-sm">
                {emptyText}
              </CommandPrimitive.Empty>
            ) : null}
            {showQueryChoice ? (
              <CommandPrimitive.Item
                value={queryValue}
                onSelect={() => toggle(queryValue)}
                className="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none"
              >
                <span className="line-clamp-1 flex-1">Starts with {queryValue}</span>
                <CheckIcon className="absolute right-2 size-4 opacity-0" />
              </CommandPrimitive.Item>
            ) : null}
            {filteredOptions.map((option) => {
              const on = selected.has(option.value)
              return (
                <CommandPrimitive.Item
                  key={option.value}
                  value={option.value}
                  onSelect={() => toggle(option.value)}
                  className="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none"
                >
                  <span className="line-clamp-1 flex-1">{option.label}</span>
                  <CheckIcon
                    className={cn("absolute right-2 size-4", on ? "opacity-100" : "opacity-0")}
                  />
                </CommandPrimitive.Item>
              )
            })}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
