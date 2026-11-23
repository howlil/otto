import { ActiveIndicatorGroup, Icon, Range, SettingBlock, Text } from "../../../../shared/ui";
import {
  BACKGROUND_OPACITY_RANGE,
  type BackgroundStyle,
  type Preferences,
} from "../../model/preferences";

const BACKGROUND_CHOICES: ReadonlyArray<{
  value: BackgroundStyle;
  label: string;
  caption: string;
}> = [
  { value: "solid", label: "Solid", caption: "Opaque surface" },
  { value: "blur", label: "Blur", caption: "Frosted acrylic" },
  { value: "liquid-glass", label: "Liquid Glass", caption: "Refractive glass" },
];

function SurfaceMaterialIllustration({ variant }: { variant: BackgroundStyle }) {
  const pillStyle =
    variant === "solid"
      ? "border border-otto-line bg-otto-surface"
      : variant === "blur"
        ? "border border-white/15 bg-otto-surface/60 backdrop-blur-[6px]"
        : "border border-white/30 bg-gradient-to-br from-white/25 via-otto-surface/45 to-otto-hljs-function/20 backdrop-blur-[8px] shadow-[inset_0_1px_0_0_rgb(255_255_255/35%)]";

  return (
    <span
      aria-hidden="true"
      data-material-preview={variant}
      className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-otto-control border border-otto-line-soft bg-otto-ink-deep"
    >
      <span className="pointer-events-none absolute -left-1 top-1 h-7 w-7 rounded-full bg-otto-hljs-keyword/65 blur-[4px]" />
      <span className="pointer-events-none absolute right-1 top-0.5 h-7 w-7 rounded-full bg-otto-hljs-function/65 blur-[4px]" />
      <span className="pointer-events-none absolute bottom-0 left-1/3 h-6 w-8 rounded-full bg-otto-warn/55 blur-[4px]" />
      <span
        className={`relative z-10 flex h-6 w-[78%] items-center gap-1.5 rounded-full px-2 ${pillStyle}`}
      >
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center gap-[2px] rounded-full bg-otto-raised-soft">
          <i className="block h-1.5 w-[2px] rounded-full bg-otto-agent-eye" />
          <i className="block h-1.5 w-[2px] rounded-full bg-otto-agent-eye" />
        </span>
        <span className="flex flex-1 flex-col gap-1">
          <i className="block h-1 w-3/4 rounded-full bg-otto-text/75" />
          <i className="block h-1 w-1/2 rounded-full bg-otto-text-tertiary/65" />
        </span>
        {variant === "liquid-glass" && (
          <span className="pointer-events-none absolute inset-x-2 top-0 h-[1px] bg-white/50" />
        )}
      </span>
    </span>
  );
}

export function BackgroundSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  const [minOpacity, maxOpacity] = BACKGROUND_OPACITY_RANGE;
  const activeStyle = prefs.backgroundStyle;

  return (
    <SettingBlock title="Background" icon="layers">
      <div className="space-y-2.5">
        <ActiveIndicatorGroup
          activeKey={activeStyle}
          className="grid grid-cols-3 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
        >
          {BACKGROUND_CHOICES.map((choice) => {
            const selected = activeStyle === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                title={choice.caption}
                data-active-key={choice.value}
                onClick={() => change({ backgroundStyle: choice.value })}
                className={[
                  "relative z-[1] flex min-w-0 flex-col gap-1.5 rounded-otto-card border p-2 text-left transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected",
                  selected
                    ? "border-transparent bg-transparent text-otto-text"
                    : "border-otto-line bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text",
                ].join(" ")}
              >
                <SurfaceMaterialIllustration variant={choice.value} />
                <span className="flex w-full items-center justify-between gap-1 px-0.5">
                  <Text as="span" variant="label" className="truncate">
                    {choice.label}
                  </Text>
                  {selected && (
                    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
                      <Icon name="check" size={9} />
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="px-0.5 text-otto-2xs leading-tight text-otto-text-tertiary"
                >
                  {choice.caption}
                </span>
              </button>
            );
          })}
        </ActiveIndicatorGroup>
        {activeStyle !== "solid" && (
          <Range
            icon="general"
            label="Opacity"
            value={prefs.backgroundOpacity}
            min={minOpacity}
            max={maxOpacity}
            unit="%"
            onChange={(backgroundOpacity) => change({ backgroundOpacity })}
          />
        )}
      </div>
    </SettingBlock>
  );
}
