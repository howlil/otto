import { Text } from "../../shared/ui";

export function AgentUsageSettings() {
  return (
    <section aria-labelledby="otto-model-usage-title">
      <h2 id="otto-model-usage-title" className="sr-only">
        Model and context usage
      </h2>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 text-otto-sm">
        <dt className="text-otto-text-tertiary">Active model</dt>
        <dd>Not detected</dd>
        <dt className="text-otto-text-tertiary">Thinking effort</dt>
        <dd>Unavailable</dd>
        <dt className="text-otto-text-tertiary">Context used</dt>
        <dd>Unavailable</dd>
        <dt className="text-otto-text-tertiary">Context remaining</dt>
        <dd>Unavailable</dd>
      </dl>
      <Text as="p" variant="caption" className="mt-4 leading-[1.5] text-otto-text-tertiary">
        Native provider snapshots do not expose model, thinking effort, or token usage.
        Values remain unavailable until a provider confirms them. Context remaining is not
        an account token quota.
      </Text>
    </section>
  );
}
