import {
  Button,
  LOGO_BADGE_TONES,
  LOGO_EYE_STYLES,
  LOGO_EYE_TONES,
  LOGO_SHAPES,
  OttoLogo,
  Text,
  type IconName,
  type LogoConfig,
} from "../../../../shared/ui";

export interface StageAction {
  key: string;
  icon: IconName;
  label: string;
  onClick: () => void;
}

function describeLogoSummary(config: LogoConfig): string {
  if (config.customSvg) return "Custom uploaded SVG";
  const find = <T extends { id: string; label: string }>(items: readonly T[], id: string) =>
    items.find((item) => item.id === id)?.label ?? id;
  return `${find(LOGO_SHAPES, config.shape)} · ${find(LOGO_EYE_STYLES, config.eyeStyle)} eyes · ${find(LOGO_BADGE_TONES, config.badgeTone)} / ${find(LOGO_EYE_TONES, config.eyeTone)}`;
}

export function LogoStageHeader({
  config,
  isCustom,
  actions,
  onReset,
}: {
  config: LogoConfig;
  isCustom: boolean;
  actions: readonly StageAction[];
  onReset: () => void;
}) {
  const cols = actions.length === 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <div className="space-y-2.5 rounded-otto-card border border-otto-line-soft bg-otto-ink-deep p-3">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-2 rounded-otto-control border border-otto-line-soft bg-otto-surface px-2.5 py-1.5">
            <OttoLogo config={config} expressive />
            <OttoLogo compact config={config} expressive />
          </div>
          <div className="min-w-0">
            <Text as="p" variant="label" className="truncate text-otto-text">
              Otto mark
            </Text>
            <Text as="p" variant="caption" className="truncate text-otto-text-tertiary">
              {describeLogoSummary(config)}
            </Text>
          </div>
        </div>
        {isCustom && (
          <Button variant="quiet" size="xs" icon="reset" className="shrink-0" onClick={onReset}>
            Reset logo
          </Button>
        )}
      </div>
      <div className={`grid gap-1.5 border-t border-otto-line-soft pt-2.5 ${cols}`}>
        {actions.map((action) => (
          <Button
            key={action.key}
            variant="secondary"
            size="xs"
            icon={action.icon}
            className="w-full justify-center"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
