import type { Dispatch, SetStateAction } from "react";
import { CopyAnswerButton } from "./CopyAnswerButton";

export function ConversationToolbar({
  messageCount,
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
  return (
    <>
      {messageCount > 0 && (
        <div className="shrink-0 px-[18px] pt-1">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSearchOpen((current) => !current);
                setSearchTerm("");
                setMatchCursor(0);
              }}
              className="rounded-full px-2 py-1 text-otto-xs text-otto-text-tertiary hover:bg-otto-control-deep hover:text-otto-text"
            >
              {searchOpen ? "Close search" : "Search"}
            </button>
            <button
              type="button"
              onClick={exportMarkdown}
              className="rounded-full px-2 py-1 text-otto-xs text-otto-text-tertiary hover:bg-otto-control-deep hover:text-otto-text"
            >
              Export .md
            </button>
            <CopyAnswerButton value={markdown} label="Copy Markdown" />
          </div>
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
                  if (event.key === "Escape") setSearchOpen(false);
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
