import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton, StatusMessage, Text, TextField } from "../../shared/ui";
import { filterConversations, normalizeTitle, orderConversations } from "./history-model";
import { HistoryDeleteAllPrompt } from "./HistoryDeleteAllPrompt";
import { HistoryRows } from "./HistoryRows";
import type { AgentHistoryModel } from "./view-model";

const SEARCH_FIELD = "otto-history-search";

function HistorySearch({
  query,
  setQuery,
  pending,
  hasItems,
  onRefresh,
  onDeleteAll,
}: {
  query: string;
  setQuery: (value: string) => void;
  pending: boolean;
  hasItems: boolean;
  onRefresh: () => void;
  onDeleteAll: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-[15px] pb-[7px] pt-[9px]">
      <label
        htmlFor={SEARCH_FIELD}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-otto-control border border-otto-line bg-otto-field-deep px-[9px] focus-within:border-otto-line-focused"
      >
        <Text as="span" variant="meta" className="shrink-0 text-otto-muted">
          Search
        </Text>
        <TextField
          id={SEARCH_FIELD}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Saved conversations"
          spellCheck={false}
          density="compact"
          appearance="embedded"
          className="min-w-0 flex-1 placeholder:text-otto-text-subtle"
        />
      </label>
      <IconButton
        icon="history"
        label="Refresh conversation history"
        variant="outlined"
        disabled={pending}
        onClick={onRefresh}
      />
      <Button
        variant="quiet"
        size="xs"
        className="text-otto-danger-detail"
        disabled={pending || !hasItems}
        onClick={onDeleteAll}
      >
        Delete all history
      </Button>
    </div>
  );
}

export function History({
  history,
  busy,
  onDone,
  onMeasured,
}: {
  history: AgentHistoryModel;
  busy: boolean;
  onDone: () => void;
  onMeasured: (height: number) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const rows = filterConversations(orderConversations(history.conversations), history.query);
  const disabled = busy || history.pending;
  const now = Date.now();

  useEffect(() => {
    if (renamingId) renameInput.current?.focus({ preventScroll: true });
  }, [renamingId]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      onMeasured(51 + (element.firstElementChild?.scrollHeight ?? element.scrollHeight) + 16);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [onMeasured]);

  const commitRename = (id: string) => {
    setRenamingId(null);
    if (normalizeTitle(titleDraft)) void history.rename(id, titleDraft);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HistorySearch
        query={history.query}
        setQuery={history.setQuery}
        pending={history.pending}
        hasItems={history.conversations.length > 0}
        onRefresh={() => void history.refresh()}
        onDeleteAll={() => setConfirmAll(true)}
      />
      <div
        ref={viewport}
        className="otto-scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto px-[15px] pb-3 [overscroll-behavior:contain]"
      >
        <div className="min-w-0">
          {confirmAll && history.conversations.length > 0 && (
            <HistoryDeleteAllPrompt
              disabled={disabled}
              onConfirm={async () => {
                if (await history.removeAll()) setConfirmAll(false);
              }}
              onCancel={() => setConfirmAll(false)}
            />
          )}
          {history.error && (
            <StatusMessage
              tone="error"
              className="mb-2 rounded-[11px] border border-otto-danger bg-otto-field-deep p-2.5 text-otto-danger-detail"
              action={{ label: "Retry", onClick: () => void history.refresh() }}
            >
              {history.error}
            </StatusMessage>
          )}
          {!history.error && rows.length === 0 && (
            <Text as="p" variant="meta" className="m-0 py-6 text-center text-otto-text-tertiary">
              {history.query.trim()
                ? "No saved conversation matches this search."
                : "No saved conversations yet. Finished answers appear here."}
            </Text>
          )}
          <HistoryRows
            rows={rows}
            now={now}
            disabled={disabled}
            titleDraft={titleDraft}
            renameInput={renameInput}
            renamingId={renamingId}
            confirmId={confirmId}
            onDraft={setTitleDraft}
            onOpen={(id) => {
              void history.open(id).then((opened) => opened && onDone());
            }}
            onStartRename={(conversation) => {
              setConfirmId(null);
              setTitleDraft(conversation.title);
              setRenamingId(conversation.id);
            }}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingId(null)}
            onStartDelete={(id) => {
              setRenamingId(null);
              setConfirmId(id);
            }}
            onConfirmDelete={(id) => {
              setConfirmId(null);
              void history.remove(id);
            }}
            onCancelDelete={() => setConfirmId(null)}
          />
        </div>
      </div>
    </section>
  );
}
