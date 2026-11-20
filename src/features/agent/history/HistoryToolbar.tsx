import { Button, Icon, IconButton, Text, TextField, VisuallyHidden } from "../../../shared/ui";

const SEARCH_FIELD = "otto-history-search";

function summaryCountLabel(total: number, matched: number, hasQuery: boolean): string {
  if (hasQuery) {
    return `${matched} of ${total} saved`;
  }
  return total === 1 ? "1 saved conversation" : `${total} saved conversations`;
}

export function HistoryToolbar({
  query,
  setQuery,
  pending,
  busy,
  totalCount,
  matchedCount,
  onRefresh,
  onDeleteAll,
}: {
  query: string;
  setQuery: (value: string) => void;
  pending: boolean;
  busy: boolean;
  totalCount: number;
  matchedCount: number;
  onRefresh: () => void;
  onDeleteAll: () => void;
}) {
  const hasItems = totalCount > 0;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-[15px] pb-2 pt-2.5">
      <div className="flex items-center gap-1.5">
        <label
          htmlFor={SEARCH_FIELD}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-otto-control border border-otto-line bg-otto-field-deep px-2.5 transition-colors duration-150 focus-within:border-otto-line-focused"
        >
          <Icon name="search" size={14} className="shrink-0 text-otto-text-tertiary" />
          <VisuallyHidden>Search saved conversations</VisuallyHidden>
          <TextField
            id={SEARCH_FIELD}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search titles, messages, or engine…"
            spellCheck={false}
            density="compact"
            appearance="embedded"
            className="min-w-0 flex-1 placeholder:text-otto-text-subtle"
          />
          {query.length > 0 && (
            <IconButton
              icon="close"
              size={13}
              label="Clear search"
              title="Clear search"
              variant="quiet"
              className="h-5 w-5 rounded-otto-chip"
              onClick={() => setQuery("")}
            />
          )}
        </label>
        <IconButton
          icon="refresh"
          size={14}
          label="Refresh conversation history"
          title="Refresh conversation history"
          variant="outlined"
          disabled={pending}
          onClick={onRefresh}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <Text
          as="span"
          variant="caption"
          className="min-w-0 truncate tabular-nums text-otto-text-tertiary"
        >
          {summaryCountLabel(totalCount, matchedCount, hasQuery)}
          {busy ? " · Finish current request to switch" : ""}
        </Text>
        <Button
          variant="quiet"
          size="link"
          className="text-otto-text-tertiary hover:text-otto-danger-detail disabled:opacity-40"
          disabled={pending || busy || !hasItems}
          onClick={onDeleteAll}
        >
          Delete all history
        </Button>
      </div>
    </div>
  );
}

export function HistoryEmptyState({
  hasQuery,
  onClearSearch,
}: {
  hasQuery: boolean;
  onClearSearch: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-otto-panel border border-otto-line-soft bg-otto-control/40 px-4 py-6 text-center">
      <div className="mb-2 grid h-8 w-8 place-items-center rounded-full border border-otto-line-soft bg-otto-raised-soft text-otto-text-tertiary">
        <Icon name={hasQuery ? "search" : "history"} size={15} />
      </div>
      <Text as="p" variant="meta" className="m-0 text-otto-text-secondary">
        {hasQuery
          ? "No saved conversation matches this search."
          : "No saved conversations yet. Finished answers appear here."}
      </Text>
      <Text as="p" variant="caption" className="m-0 mt-1 max-w-[280px] text-otto-text-tertiary">
        {hasQuery
          ? "Try searching for another topic, question, or AI engine name."
          : "Ask Otto a question or capture context from your screen to build your study history."}
      </Text>
      {hasQuery && (
        <Button variant="secondary" size="xs" className="mt-3" onClick={onClearSearch}>
          Clear search
        </Button>
      )}
    </div>
  );
}
