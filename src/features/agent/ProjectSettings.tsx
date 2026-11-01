import { useRef } from "react";
import { Icon, Text, TextField } from "../../shared/ui";

export function ProjectSettings({
  cwd,
  locked,
  setCwd,
  onBeginEdit,
  onCommit,
  onCancel,
}: {
  cwd: string;
  locked: boolean;
  setCwd: (cwd: string) => void;
  onBeginEdit: () => void;
  onCommit: (cwd: string) => void;
  onCancel: () => void;
}) {
  const skipCommit = useRef(false);
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-[10px]">
        <label
          className="mb-2 block text-otto-xs leading-[1.4] text-otto-muted-strong"
          htmlFor="otto-project"
        >
          Working project
        </label>
        {locked && (
          <Text
            as="span"
            variant="caption"
            className="uppercase tracking-[0.03em] text-otto-text-subtle"
          >
            Fixed
          </Text>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-[10px] text-otto-label-faded focus-within:border-otto-disabled-selected">
        <Icon name="folder" size={15} />
        <TextField
          id="otto-project"
          value={cwd}
          onFocus={onBeginEdit}
          onChange={(e) => setCwd(e.target.value)}
          onBlur={(event) => {
            if (skipCommit.current) {
              skipCommit.current = false;
              return;
            }
            onCommit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              skipCommit.current = true;
              onCancel();
              event.currentTarget.blur();
            }
          }}
          placeholder="Folder path"
          disabled={locked}
          title={locked ? "Start a new session to change the working project" : undefined}
          spellCheck={false}
          className="h-[33px] min-w-0 flex-1 border-0 bg-transparent text-otto-sm text-otto-knob outline-none disabled:opacity-[0.65]"
        />
      </div>
    </section>
  );
}
