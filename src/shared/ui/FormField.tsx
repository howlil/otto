import type { ComponentPropsWithRef, ComponentPropsWithoutRef } from "react";

export type FieldDensity = "compact" | "standard";
export type FieldAppearance = "surface" | "embedded";

const fieldDensityClasses: Record<FieldDensity, string> = {
  compact: "h-[29px]",
  standard: "h-[35px]",
};

const fieldAppearanceClasses: Record<FieldAppearance, string> = {
  surface:
    "w-full rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2 text-otto-sm text-otto-text outline-none focus:border-otto-line-focused disabled:opacity-50",
  embedded: "border-0 bg-transparent text-otto-sm text-otto-knob outline-none disabled:opacity-50",
};

function fieldClassName(density: FieldDensity, appearance: FieldAppearance, className: string) {
  return `${fieldDensityClasses[density]} ${fieldAppearanceClasses[appearance]} ${className}`.trim();
}

export function TextField({
  density = "standard",
  appearance = "surface",
  className = "",
  ...props
}: ComponentPropsWithRef<"input"> & {
  density?: FieldDensity;
  appearance?: FieldAppearance;
}) {
  return <input {...props} className={fieldClassName(density, appearance, className)} />;
}

export function SelectField({
  density = "standard",
  className = "",
  ...props
}: ComponentPropsWithoutRef<"select"> & { density?: FieldDensity }) {
  return <select {...props} className={fieldClassName(density, "surface", className)} />;
}
