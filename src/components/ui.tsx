"use client";

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { FAMILY_LABELS, type Preset, type PresetPurpose } from "@/lib/shared/types";

type Variant = "primary" | "ghost" | "outline" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-strong text-white hover:bg-accent disabled:bg-raised disabled:text-faint",
  ghost: "text-muted hover:bg-raised hover:text-fg disabled:text-faint disabled:hover:bg-transparent",
  outline: "border border-line text-fg hover:bg-raised disabled:text-faint",
  danger: "text-bad hover:bg-bad/10",
};

export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function IconButton({
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={`grid size-8 place-items-center rounded-lg text-muted transition hover:bg-raised hover:text-fg disabled:text-faint ${className}`}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg outline-none focus:border-accent ${className}`}
    />
  );
}

export function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs transition ${
        on ? "bg-accent-strong/25 text-accent ring-1 ring-accent/50" : "text-muted hover:bg-raised hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function PresetSelect({
  presets: all,
  purpose,
  value,
  onChange,
  className,
}: {
  presets: Preset[];
  /** Only offer presets written for this job. */
  purpose: PresetPurpose;
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const presets = all.filter((p) => p.purpose === purpose);
  const families = [...new Set(presets.map((p) => p.family))];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} title="System prompt 範本">
      {families.map((f) => (
        <optgroup key={f} label={FAMILY_LABELS[f]}>
          {presets
            .filter((p) => p.family === f)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-accent";
