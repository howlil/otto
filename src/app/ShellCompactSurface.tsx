import { AgentCapsule } from "../features/agent";
import type { AgentViewModel } from "../features/agent";
import type { ShellViewModel } from "../features/shell";

export function ShellCompactSurface({
  agent,
  shell,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
}) {
  return (
    <AgentCapsule
      snapshot={agent.snapshot}
      installed={agent.installed}
      readiness={agent.readiness}
      error={agent.error}
      circle={shell.compactCircle}
      buttonRef={shell.compactButton}
      onOpen={() => shell.open("agent")}
      onToggleCompactStyle={shell.ottoOs ? undefined : shell.toggleCompactStyle}
    />
  );
}
