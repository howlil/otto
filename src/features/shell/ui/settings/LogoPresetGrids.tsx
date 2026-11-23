import {
  LOGO_BADGE_TONES,
  LOGO_EYE_STYLES,
  LOGO_EYE_TONES,
  LOGO_SHAPES,
  OttoLogo,
  Text,
  VisuallyHidden,
  type LogoConfig,
} from "../../../../shared/ui";

export function LogoPresetGrids({
  config,
  update,
}: {
  config: LogoConfig;
  update: (patch: Partial<LogoConfig>) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <Text as="p" variant="caption" className="mb-1.5 text-otto-text-tertiary">
          Badge shape
        </Text>
        <div className="grid grid-cols-5 gap-1.5">
          {LOGO_SHAPES.map((shape) => {
            const selected = config.shape === shape.id;
            return (
              <button
                key={shape.id}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ shape: shape.id })}
                className={`flex flex-col items-center gap-1.5 rounded-otto-control border py-2 text-otto-2xs transition-colors ${
                  selected
                    ? "border-otto-line-focused bg-otto-selected text-otto-text"
                    : "border-otto-line-soft bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:text-otto-text"
                }`}
              >
                <OttoLogo
                  compact
                  previewMinimalFrame={shape.id === "minimal"}
                  config={{
                    ...config,
                    shape: shape.id,
                    eyeScale: 100,
                    eyeGap: 8,
                    glow: false,
                    customSvg: null,
                  }}
                />
                <span>{shape.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Text as="p" variant="caption" className="mb-1.5 text-otto-text-tertiary">
          Eye style
        </Text>
        <div className="grid grid-cols-5 gap-1.5">
          {LOGO_EYE_STYLES.map((style) => {
            const selected = config.eyeStyle === style.id;
            return (
              <button
                key={style.id}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ eyeStyle: style.id, customSvg: null })}
                className={`flex flex-col items-center gap-1.5 rounded-otto-control border py-2 text-otto-2xs transition-colors ${
                  selected
                    ? "border-otto-line-focused bg-otto-selected text-otto-text"
                    : "border-otto-line-soft bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:text-otto-text"
                }`}
              >
                <OttoLogo
                  compact
                  config={{
                    ...config,
                    shape: config.shape === "minimal" ? "squircle" : config.shape,
                    eyeStyle: style.id,
                    eyeScale: 100,
                    eyeGap: 8,
                    glow: false,
                    customSvg: null,
                  }}
                />
                <span>{style.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Text as="p" variant="caption" className="mb-1.5 text-otto-text-tertiary">
            Badge color
          </Text>
          <div className="flex flex-wrap items-center gap-1.5">
            {LOGO_BADGE_TONES.map((tone) => {
              const selected = config.badgeTone === tone.id;
              return (
                <button
                  key={tone.id}
                  type="button"
                  aria-pressed={selected}
                  title={`Badge: ${tone.label}`}
                  onClick={() => update({ badgeTone: tone.id })}
                  className={`size-5 rounded-full border ${tone.bgClass} ${
                    selected
                      ? "border-otto-invert-line ring-2 ring-otto-line-focused"
                      : "border-otto-line-strong hover:border-otto-line-hover"
                  }`}
                >
                  <VisuallyHidden>Badge color {tone.label}</VisuallyHidden>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Text as="p" variant="caption" className="mb-1.5 text-otto-text-tertiary">
            Eye color
          </Text>
          <div className="flex flex-wrap items-center gap-1.5">
            {LOGO_EYE_TONES.map((tone) => {
              const selected = config.eyeTone === tone.id;
              return (
                <button
                  key={tone.id}
                  type="button"
                  aria-pressed={selected}
                  title={`Eyes: ${tone.label}`}
                  onClick={() => update({ eyeTone: tone.id, customSvg: null })}
                  className={`size-5 rounded-full border ${tone.bgClass} ${
                    selected
                      ? "border-otto-invert-line ring-2 ring-otto-line-focused"
                      : "border-otto-line-strong hover:border-otto-line-hover"
                  }`}
                >
                  <VisuallyHidden>Eye color {tone.label}</VisuallyHidden>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
