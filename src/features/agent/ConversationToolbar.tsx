import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { CopyAnswerButton } from "./CopyAnswerButton";

export function ConversationToolbar({
  messageCount,
  actionsOpen,
  setActionsOpen,
  searchOpen,
  searchTerm,
  matchCursor,
  matches,
  markdown,
  exportError,
  exportMarkdown,
  setSearchOpen,
  setSearchTerm,
  setMatchCursor,
}: {
  messageCount: number;
  actionsOpen: boolean;
  setActionsOpen: (open: boolean) => void;
  searchOpen: boolean;
  searchTerm: string;
  matchCursor: number;
  matches: number[];
  markdown: string;
  exportError: boolean;
  exportMarkdown: () => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  setMatchCursor: Dispatch<SetStateAction<number>>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (actionsOpen) menu.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [actionsOpen]);
  useEffect(() => {
    if (searchOpen) document.getElementById("otto-conversation-search")?.focus();
  }, [searchOpen]);
  const closeMenu = () => {
    setActionsOpen(false);
    document.getElementById("otto-conversation-actions")?.focus({ preventScroll: true });
  };
  return (
    <>
      {actionsOpen && (
        <div
          id="otto-conversation-menu"
          ref={menu}
          role="group"
          aria-label="Conversation actions"
          className="absolute right-[42px] top-[49px] z-20 flex w-[184px] flex-col gap-1 rounded-otto-card border border-otto-line-hover bg-otto-control-deep p-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
            }
          }}
        >
          <button
            type="button"
            className="rounded-otto-control px-2 py-2 text-left text-otto-sm text-otto-text hover:bg-otto-selected-hover"
            onClick={() => {
              setActionsOpen(false);
              setSearchOpen(true);
              setSearchTerm("");
              setMatchCursor(0);
            }}
          >
            Find in conversation
          </button>
          <div className="px-2"><CopyAnswerButton value={markdown} label="Copy Markdown" /></div>
          <button
            type="button"
            disabled={!messageCount}
            className="rounded-otto-control px-2 py-2 text-left text-otto-sm text-otto-text hover:bg-otto-selected-hover disabled:opacity-40"
            onClick={() => { setActionsOpen(false); exportMarkdown(); }}
          >
            Export .md
          </button>
        </div>
      )}
      {(searchOpen || exportError) && (
        <div className="shrink-0 px-[18px] pt-1">
          {searchOpen && (
            <div className="flex items-center gap-2 pb-1">
              <label className="sr-only" htmlFor="otto-conversation-search">
                Search conversation
              </label>
              <input
                id="otto-conversation-search"
                type="search"
                value={searchTerm}
                placeholder="Find in conversation"
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setMatchCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setSearchOpen(false);
                    document.getElementById("otto-conversation-actions")?.focus();
                  }
                  if (event.key === "Enter" && matches.length)
                    setMatchCursor((cursor) => (cursor + 1) % matches.length);
                }}
                className="h-8 min-w-0 flex-1 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2 text-otto-sm text-otto-text outline-none"
              />
              <span className="shrink-0 text-otto-xs text-otto-text-tertiary" role="status">
                {searchTerm.trim()
                  ? matches.length
                    ? (matchCursor % matches.length) + 1 + "/" + matches.length
                    : "No results"
                  : "Find"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setMatchCursor((cursor) => (cursor + matches.length - 1) % matches.length)
                }
                disabled={!matches.length}
                className="text-otto-xs text-otto-text-secondary disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setMatchCursor((cursor) => (cursor + 1) % matches.length)}
                disabled={!matches.length}
                className="text-otto-xs text-otto-text-secondary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
          {exportError && (
            <p role="alert" className="text-otto-xs text-otto-danger">
              Save unavailable. Use Copy Markdown instead.
            </p>
          )}
        </div>
      )}
    </>
  );
}
