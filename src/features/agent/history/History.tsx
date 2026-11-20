import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { StatusMessage, useTransitionActive } from "../../../shared/ui";
import { filterConversations, normalizeTitle, orderConversations } from "./history-model";
import { HistoryDeleteAllPrompt } from "./HistoryDeleteAllPrompt";
import { HistoryRows } from "./HistoryRows";
import { HistoryEmptyState, HistoryToolbar } from "./HistoryToolbar";
import type { AgentHistoryModel } from "../model/view-model";

function useHistoryViewportMeasure(
  active: boolean,
  viewport: RefObject<HTMLDivElement | null>,
  onMeasured: (height: number) => void,
) {
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!active || !element) return;
    const measure = () =>
      onMeasured(72 + (element.firstElementChild?.scrollHeight ?? element.scrollHeight) + 16);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [active, viewport, onMeasured]);
}

function useHistoryRowState(history: AgentHistoryModel) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameInput.current?.focus({ preventScroll: true });
  }, [renamingId]);

  const commitRename = (id: string) => {
    setRenamingId(null);
    if (normalizeTitle(titleDraft)) void history.rename(id, titleDraft);
  };

  return {
    renamingId,
    setRenamingId,
    titleDraft,
    setTitleDraft,
    confirmId,
    setConfirmId,
    confirmAll,
    setConfirmAll,
    renameInput,
    commitRename,
  };
}

export function History({
  history,
  activeConversationId = null,
  busy,
  onDone,
  onMeasured,
}: {
  history: AgentHistoryModel;
  activeConversationId?: string | null;
  busy: boolean;
  onDone: () => void;
  onMeasured: (height: number) => void;
}) {
  const active = useTransitionActive();
  const rowState = useHistoryRowState(history);
  const viewport = useRef<HTMLDivElement>(null);
  const ordered = orderConversations(history.conversations);
  const rows = history.serverFiltered ? ordered : filterConversations(ordered, history.query);
  const disabled = busy || history.pending;
  const now = Date.now();

  useHistoryViewportMeasure(active, viewport, onMeasured);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HistoryToolbar
        query={history.query}
        setQuery={history.setQuery}
        pending={history.pending}
        busy={busy}
        totalCount={history.conversations.length}
        matchedCount={rows.length}
        onRefresh={() => void history.refresh()}
        onDeleteAll={() => rowState.setConfirmAll(true)}
      />
      <div
        ref={viewport}
        className="otto-scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto px-[15px] pb-3 [overscroll-behavior:contain]"
      >
        <div className="min-w-0">
          {rowState.confirmAll && history.conversations.length > 0 && (
            <HistoryDeleteAllPrompt
              disabled={disabled}
              onConfirm={async () => {
                if (await history.removeAll()) rowState.setConfirmAll(false);
              }}
              onCancel={() => rowState.setConfirmAll(false)}
            />
          )}
          {history.error && (
            <StatusMessage
              tone="error"
              className="mb-2.5 rounded-otto-panel border border-otto-danger bg-otto-field-deep p-2.5 text-otto-danger-detail"
              action={{ label: "Retry", onClick: () => void history.refresh() }}
            >
              {history.error}
            </StatusMessage>
          )}
          {!history.error && rows.length === 0 && (
            <HistoryEmptyState
              hasQuery={history.query.trim().length > 0}
              onClearSearch={() => history.setQuery("")}
            />
          )}
          <HistoryRows
            rows={rows}
            activeConversationId={activeConversationId}
            exportedId={history.exportedId}
            now={now}
            disabled={disabled}
            titleDraft={rowState.titleDraft}
            renameInput={rowState.renameInput}
            renamingId={rowState.renamingId}
            confirmId={rowState.confirmId}
            onDraft={rowState.setTitleDraft}
            onOpen={(id) => {
              void history.open(id).then((opened) => opened && onDone());
            }}
            onExport={
              history.exportMarkdown ? (id) => void history.exportMarkdown?.(id) : undefined
            }
            onStartRename={(conversation) => {
              rowState.setConfirmId(null);
              rowState.setTitleDraft(conversation.title);
              rowState.setRenamingId(conversation.id);
            }}
            onCommitRename={rowState.commitRename}
            onCancelRename={() => rowState.setRenamingId(null)}
            onStartDelete={(id) => {
              rowState.setRenamingId(null);
              rowState.setConfirmId(id);
            }}
            onConfirmDelete={(id) => {
              rowState.setConfirmId(null);
              void history.remove(id);
            }}
            onCancelDelete={() => rowState.setConfirmId(null)}
          />
        </div>
      </div>
    </section>
  );
}
