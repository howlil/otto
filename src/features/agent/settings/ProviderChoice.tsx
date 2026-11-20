import { Icon } from "../../../shared/ui";
import { providerLogo } from "./provider-logos";

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

export function ProviderChoice({
  name,
  command,
  installed,
  status,
  selected,
  locked,
  onSelect,
}: {
  name: string;
  command: string;
  installed: boolean;
  status: string;
  selected: boolean;
  locked: boolean;
  onSelect?: () => void;
}) {
  const displayName = name === "Agy" ? "Antigravity" : name;
  const logo = providerLogo(name);
  const title = installed
    ? `${displayName} (${command})`
    : `${displayName} isn't installed. Install its command-line tool (${command}), then press Refresh.`;
  return (
    <button
      type="button"
      data-active-key={command}
      className={`group relative z-[1] flex min-h-[48px] min-w-0 items-center gap-2.5 rounded-otto-card border px-2.5 text-left text-otto-text transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${selected ? "border-transparent bg-transparent" : "border-otto-line bg-otto-control hover:border-otto-line-hover hover:bg-otto-control-hover"} ${installed ? "" : "opacity-60"}`}
      disabled={locked && installed}
      aria-disabled={!installed || undefined}
      aria-pressed={selected}
      onClick={installed ? onSelect : undefined}
      title={title}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-otto-control bg-otto-raised-deep">
        {logo?.tinted ? (
          <span
            aria-hidden="true"
            className="block size-5 bg-otto-text"
            style={maskStyle(logo.src)}
          />
        ) : logo ? (
          <img src={logo.src} alt="" className="size-5 object-contain" draggable={false} />
        ) : (
          <Icon name="terminal" size={18} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-otto-sm font-semibold">{displayName}</span>
        {!installed && (
          <span className="block truncate text-otto-xs text-otto-muted">Not installed</span>
        )}
      </span>
      {selected && (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
          <Icon name="check" size={10} />
        </span>
      )}
      <span className="sr-only">{status}</span>
    </button>
  );
}
