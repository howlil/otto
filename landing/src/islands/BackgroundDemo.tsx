import { useState } from "react";

type Background = "solid" | "blur" | "liquid-glass";

const options: { id: Background; label: string; caption: string }[] = [
  { id: "solid", label: "Solid", caption: "Opaque surface" },
  { id: "blur", label: "Blur", caption: "Frosted acrylic" },
  { id: "liquid-glass", label: "Liquid Glass", caption: "Refractive glass" },
];

export default function BackgroundDemo() {
  const [background, setBackground] = useState<Background>("liquid-glass");
  const [opacity, setOpacity] = useState(72);
  const surface =
    background === "solid"
      ? "rgb(16 17 20)"
      : background === "blur"
        ? `rgb(16 17 20 / ${opacity / 100})`
        : `linear-gradient(135deg, rgb(255 255 255 / 0.18) 0%, rgb(16 17 20 / ${opacity / 100}) 48%, rgb(159 188 216 / 0.16) 100%)`;

  return (
    <div className="space-y-6">
      <div className="relative h-[190px] overflow-hidden rounded-otto-card border border-otto-line">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 28%, rgb(201 166 222 / 0.55), transparent 52%), radial-gradient(circle at 84% 34%, rgb(224 185 120 / 0.5), transparent 48%), linear-gradient(135deg, #2b3a4a 0%, #14334a 45%, #3d2d4f 100%)",
          }}
        />
        <div
          className={`absolute inset-x-5 top-5 h-[120px] overflow-hidden rounded-otto-expanded border transition-all duration-200 ${
            background === "solid"
              ? "border-otto-line"
              : background === "blur"
                ? "border-white/15 backdrop-blur-xl"
                : "border-white/30 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35)]"
          }`}
          style={{ background: surface }}
        >
          <div className="px-4 pt-4">
            <div className="h-2 w-1/3 rounded-full bg-otto-text-tertiary/60" />
            <div className="mt-3 h-2 w-2/3 rounded-full bg-otto-text-tertiary/40" />
            <div className="mt-2 h-2 w-1/2 rounded-full bg-otto-text-tertiary/40" />
          </div>
        </div>
      </div>
      <div>
        <p className="text-otto-md font-[590] text-otto-text">Background</p>
        <p className="mt-1 text-otto-xs leading-[1.5] text-otto-text-tertiary">
          Solid dark, frosted Blur, or refractive Liquid Glass
        </p>
        <div
          role="radiogroup"
          aria-label="Background"
          className="mt-3 grid grid-cols-3 gap-1.5"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={background === option.id}
              onClick={() => setBackground(option.id)}
              className={`rounded-otto-control border px-3 py-2 text-left text-otto-xs transition-colors duration-150 ${
                background === option.id
                  ? "border-otto-line-focused bg-otto-selected text-otto-text"
                  : "border-otto-line bg-otto-control text-otto-text-tertiary hover:text-otto-text-secondary"
              }`}
            >
              <span className="block font-medium text-otto-text">{option.label}</span>
              <span className="mt-0.5 block text-[10px] text-otto-text-tertiary">
                {option.caption}
              </span>
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="flex items-center justify-between text-otto-xs text-otto-text-secondary">
          <span>Opacity</span>
          <span className="tabular-nums">{background === "solid" ? "100" : opacity}%</span>
        </span>
        <input
          type="range"
          min={30}
          max={95}
          value={opacity}
          disabled={background === "solid"}
          onChange={(event) => setOpacity(Number(event.target.value))}
          className="mt-3 w-full accent-otto-text disabled:opacity-40"
        />
      </label>
    </div>
  );
}
