import { useState } from "react";
import { Button, StatusMessage } from "../../../shared/ui";
import type { AgentProviderDescriptor } from "../../../platform/tauri";
import { ProviderChoice } from "./ProviderChoice";

export function MissingProviders({
  providers,
  onRetry,
}: {
  providers: AgentProviderDescriptor[];
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (providers.length === 0) return null;
  return (
    <div className="mt-2">
      <Button
        variant="quiet"
        size="xs"
        icon={open ? "chevronDown" : "chevronRight"}
        className="-ml-2 text-otto-text-tertiary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {`Not installed (${providers.length})`}
      </Button>
      {open && (
        <>
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
            {providers.map(({ id, displayName, command }) => (
              <ProviderChoice
                key={id}
                name={displayName}
                command={command}
                installed={false}
                status="Not installed"
                selected={false}
                locked
              />
            ))}
          </div>
          <StatusMessage
            tone="info"
            className="mt-2 text-otto-text-tertiary"
            action={{ label: "Refresh", onClick: onRetry }}
          >
            Install the engine on this PC, then press Refresh so Otto can find it.
          </StatusMessage>
        </>
      )}
    </div>
  );
}
