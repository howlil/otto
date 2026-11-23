import type { AgentProvider, AgentProviderDescriptor } from "../../../platform/tauri";
import { Icon, Text } from "../../../shared/ui";
import { providerLabel } from "../history/history-model";
import { providerLogo } from "../settings/provider-logos";

function maskStyle(src: string) {
  const image = `url("${src.replaceAll('"', "%22")}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  } as const;
}

function EngineLogo({ name }: { name: string }) {
  const logo = providerLogo(name);
  if (logo?.tinted) {
    return (
      <span
        aria-hidden="true"
        className="block size-3.5 shrink-0 bg-current"
        style={maskStyle(logo.src)}
      />
    );
  }
  if (logo) {
    return (
      <img src={logo.src} alt="" className="size-3.5 shrink-0 object-contain" draggable={false} />
    );
  }
  return <Icon name="terminal" size={13} className="shrink-0" />;
}

export function EngineChipList({
  installed,
  provider,
  locked,
  onSelect,
}: {
  installed: AgentProviderDescriptor[];
  provider: AgentProvider;
  locked: boolean;
  onSelect: (provider: AgentProvider) => void;
}) {
  if (installed.length === 0) {
    return (
      <Text as="p" variant="caption" className="m-0 text-otto-text-tertiary">
        No installed AI engines detected yet.
      </Text>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {installed.map((item) => {
        const active = item.id === provider;
        const label = providerLabel(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            disabled={locked}
            onClick={() => onSelect(item.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-otto-chip border px-2.5 text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-otto-line-focused disabled:opacity-50 ${
              active
                ? "border-otto-line-focused bg-otto-selected text-otto-text-bright"
                : "border-otto-line-soft bg-otto-ink-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text-bright"
            }`}
          >
            <EngineLogo name={label} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
