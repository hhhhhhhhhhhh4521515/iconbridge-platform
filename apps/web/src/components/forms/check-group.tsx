'use client';

import { useId, type ReactNode } from 'react';

/** Several checkboxes for one list of values, grouped under a legend. */
export function CheckGroup({
  legend,
  hint,
  options,
  value,
  onChange,
  columns = 'sm:grid-cols-2',
}: {
  legend: string;
  hint?: string;
  options: { value: string; label: ReactNode }[];
  value: string[];
  onChange: (value: string[]) => void;
  columns?: string;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {hint ? (
        <p id={`${id}-hint`} className="mb-1 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className={`grid gap-x-4 ${columns}`}>
        {options.map((option) => (
          <label key={option.value} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 shrink-0 rounded border-input accent-primary"
              checked={value.includes(option.value)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...value, option.value]
                    : value.filter((entry) => entry !== option.value),
                );
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
