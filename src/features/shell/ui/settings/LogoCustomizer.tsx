import { useRef, useState, type ChangeEvent } from "react";
import {
  Range,
  SettingBlock,
  StatusMessage,
  Toggle,
  buildOttoLogoSvg,
  defaultLogoConfig,
  sanitizeCustomLogoSvg,
  useLogoConfig,
} from "../../../../shared/ui";
import { LogoPresetGrids } from "./LogoPresetGrids";
import { LogoStageHeader, type StageAction } from "./LogoStageHeader";

function downloadSvgFile(svg: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "otto-logo.svg";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function LogoCustomizer() {
  const [config, update, reset] = useLogoConfig();
  const [copied, setCopied] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isCustom = JSON.stringify(config) !== JSON.stringify(defaultLogoConfig);

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const clean = sanitizeCustomLogoSvg(await file.text());
    if (!clean) {
      setUploadError("Invalid SVG file. Choose a clean vector .svg under 48 KB.");
      return;
    }
    setUploadError(null);
    update({ customSvg: clean });
  };

  const actions: StageAction[] = [
    { key: "upload", icon: "upload", label: "Upload SVG", onClick: () => fileRef.current?.click() },
    ...(config.customSvg
      ? [
          {
            key: "clear",
            icon: "delete" as const,
            label: "Clear SVG",
            onClick: () => update({ customSvg: null }),
          },
        ]
      : []),
    {
      key: "copy",
      icon: "copy",
      label: copied ? "Copied SVG" : "Copy SVG",
      onClick: () => {
        void navigator.clipboard?.writeText?.(buildOttoLogoSvg(config));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
    },
    {
      key: "extract",
      icon: "download",
      label: "Extract SVG",
      onClick: () => downloadSvgFile(buildOttoLogoSvg(config)),
    },
  ];

  return (
    <SettingBlock title="Notch logo" icon="palette">
      <div className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(event) => void handleUploadChange(event)}
        />
        <LogoStageHeader
          config={config}
          isCustom={isCustom}
          actions={actions}
          onReset={() => {
            setUploadError(null);
            reset();
          }}
        />
        {uploadError && <StatusMessage tone="error">{uploadError}</StatusMessage>}
        <LogoPresetGrids config={config} update={update} />
        <Range
          icon="assistant"
          label="Eye size"
          value={config.eyeScale}
          min={75}
          max={130}
          unit="%"
          onChange={(eyeScale) => update({ eyeScale, customSvg: null })}
        />
        <Range
          icon="move"
          label="Eye spacing"
          value={config.eyeGap}
          min={4}
          max={14}
          unit=" px"
          onChange={(eyeGap) => update({ eyeGap, customSvg: null })}
        />
        <Toggle
          icon="zap"
          title="Eye glow"
          checked={config.glow}
          onChange={(glow) => update({ glow, customSvg: null })}
        />
      </div>
    </SettingBlock>
  );
}
