import { Button, SettingBlock, StatusMessage, Text } from "../../shared/ui";
import { formatModelMegabytes } from "./preferences";
import type { VoiceModelId, VoiceModelInfo, VoiceViewModel } from "./view-model";

function ModelRow({
  model,
  selected,
  runtimeInstalled,
  downloading,
  downloadProgress,
  busy,
  onSelect,
  onDownload,
  onCancelDownload,
  onDelete,
}: {
  model: VoiceModelInfo;
  selected: boolean;
  runtimeInstalled: boolean;
  downloading: boolean;
  downloadProgress: VoiceViewModel["downloadProgress"];
  busy: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onDelete: () => void;
}) {
  const ready = runtimeInstalled && model.installed;
  const activeDownload = downloading && downloadProgress?.modelId === model.id;
  const percent = activeDownload ? (downloadProgress?.percent ?? 0) : null;

  return (
    <div
      className={`flex items-center justify-between gap-2.5 rounded-otto-card border px-3 py-2 transition-colors duration-150 ${
        selected
          ? "border-otto-slider-outline bg-otto-raised-deep"
          : "border-otto-line-soft bg-otto-control hover:border-otto-line-hover"
      }`}
    >
      <button
        type="button"
        disabled={busy && !selected}
        onClick={onSelect}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-inherit"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <Text as="strong" variant="label" className="text-otto-text">
            {model.label}
          </Text>
          <Text as="span" variant="caption" className="text-otto-text-tertiary">
            {formatModelMegabytes(model.approxBytes)}
          </Text>
          {ready && (
            <span className="rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 text-otto-2xs text-otto-ok">
              Ready
            </span>
          )}
        </span>
        <Text as="p" variant="caption" className="mt-0.5 text-otto-label-muted">
          {activeDownload && downloadProgress
            ? `${downloadProgress.stage}${percent !== null ? ` (${percent}%)` : ""}`
            : model.description}
        </Text>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {activeDownload ? (
          <Button variant="quiet" size="xs" onClick={onCancelDownload}>
            Cancel
          </Button>
        ) : ready ? (
          <Button variant="quiet" size="xs" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        ) : (
          <Button size="xs" disabled={busy} onClick={onDownload}>
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

export function VoiceModelPicker({ voice }: { voice: VoiceViewModel }) {
  const { snapshot, prefs, updatePrefs, downloading, downloadProgress } = voice;
  const busy =
    snapshot.phase === "downloading" ||
    snapshot.phase === "listening" ||
    snapshot.phase === "transcribing";

  return (
    <SettingBlock
      title="Local Whisper model"
      help="Downloaded on demand and runs offline with 0 MB idle memory"
    >
      <div className="mt-1 space-y-2">
        {snapshot.models.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            selected={prefs.modelId === model.id}
            runtimeInstalled={snapshot.runtimeInstalled}
            downloading={downloading}
            downloadProgress={downloadProgress}
            busy={busy}
            onSelect={() => updatePrefs({ modelId: model.id as VoiceModelId })}
            onDownload={() => void voice.downloadModel(model.id)}
            onCancelDownload={() => void voice.cancelDownload()}
            onDelete={() => void voice.deleteModel(model.id)}
          />
        ))}
      </div>
      {snapshot.error && (
        <StatusMessage tone="error" className="mt-2">
          {snapshot.error}
        </StatusMessage>
      )}
    </SettingBlock>
  );
}
