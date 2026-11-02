import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton, StatusMessage, Text, TextField } from "../../shared/ui";
import { filterConversations, normalizeTitle, orderConversations } from "./history-model";
import { HistoryRow } from "./HistoryRow";
import type { AgentHistoryModel } from "./view-model";

const SEARCH_FIELD = "otto-history-search";

function HistorySearch({
  query,
  setQuery,
  pending,
  onRefresh,
}: {
  query: string;
  setQuery: (value: string) => void;
  pending: boolean;
  onRefresh: () => void;
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
          className="h-[29px] min-w-0 flex-1 border-0 bg-transparent text-otto-sm text-otto-knob outline-none placeholder:text-otto-text-subtle"
        />
      </label>
      <IconButton
        icon="history"
        label="Refresh conversation history"
        variant="outlined"
        disabled={pending}
        onClick={onRefresh}
      />
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
        onRefresh={() => void history.refresh()}
      />
      <div
        ref={viewport}
        className="otto-scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto px-[15px] pb-3 [overscroll-behavior:contain]"
      >
        <div className="min-w-0">
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
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {rows.map((conversation) => (
              <HistoryRow
                key={conversation.id}
                conversation={conversation}
                now={now}
                disabled={disabled}
                titleDraft={titleDraft}
                renameRef={renameInput}
                onDraft={setTitleDraft}
                mode={
                  renamingId === conversation.id
                    ? "rename"
                    : confirmId === conversation.id
                      ? "confirm"
                      : "row"
                }
                onOpen={() => {
                  void history.open(conversation.id).then((opened) => opened && onDone());
                }}
                onStartRename={() => {
                  setConfirmId(null);
                  setTitleDraft(conversation.title);
                  setRenamingId(conversation.id);
                }}
                onCommitRename={() => commitRename(conversation.id)}
                onCancelRename={() => setRenamingId(null)}
                onStartDelete={() => {
                  setRenamingId(null);
                  setConfirmId(conversation.id);
                }}
                onConfirmDelete={() => {
                  setConfirmId(null);
                  void history.remove(conversation.id);
                }}
                onCancelDelete={() => setConfirmId(null)}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
