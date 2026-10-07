import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";

export type AsyncComboboxOption = {
  value: string;
  label: string;
};

type AsyncComboboxProps = {
  value: string;
  onChange: (value: string, option: AsyncComboboxOption | null) => void;
  loadOptions: (search: string) => Promise<AsyncComboboxOption[]>;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Selected label shown when value is set but search input is idle. */
  selectedLabel?: string;
  allowClear?: boolean;
};

export function AsyncCombobox({
  value,
  onChange,
  loadOptions,
  placeholder = "Search…",
  emptyLabel = "No results",
  disabled = false,
  className,
  selectedLabel,
  allowClear = true,
}: AsyncComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [options, setOptions] = useState<AsyncComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFetched(false);
    loadOptions(debounced)
      .then((items) => {
        if (cancelled) return;
        setOptions(items);
        setFetched(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setOptions([]);
        setFetched(false);
        setError(
          err instanceof ApiClientError ? err.message : "Failed to load options.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debounced, loadOptions]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayValue = open
    ? query
    : value
      ? (selectedLabel ?? query)
      : "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("", null);
        }}
        onFocus={() => {
          setOpen(true);
          if (!query && selectedLabel) setQuery("");
        }}
        autoComplete="off"
      />
      {value && allowClear && !disabled ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
          onClick={() => {
            setQuery("");
            onChange("", null);
            setOpen(false);
          }}
        >
          Clear
        </button>
      ) : null}
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface shadow-sm"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-muted">Loading…</p>
          ) : error ? (
            <p className="px-3 py-2 text-sm text-danger">{error}</p>
          ) : fetched && options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">{emptyLabel}</p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={cn(
                  "flex w-full px-3 py-2 text-left text-sm hover:bg-canvas",
                  opt.value === value && "bg-canvas font-medium",
                )}
                onClick={() => {
                  setQuery(opt.label);
                  onChange(opt.value, opt);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
