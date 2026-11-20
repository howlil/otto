import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  deleteAgentHistory,
  deleteAllAgentHistory,
  openAgentHistory,
  renameAgentHistory,
  type AgentSnapshot,
} from "../../../platform/tauri/agent";
import {
  exportAgentHistoryMarkdown,
  searchAgentHistory,
} from "../../../platform/tauri/agent-controls";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { AgentHistoryController, type HistoryList } from "./agent-history";

function useHistoryExport(controller: RefObject<AgentHistoryController | null>) {
  const [exportedId, setExportedId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exportTimer.current) clearTimeout(exportTimer.current);
    };
  }, []);

  const exportMarkdown = useCallback(
    async (id: string) => {
      const owner = controller.current;
      if (!owner) return false;
      setExportError(null);
      const result = await owner.exportMarkdown(id);
      if (!result.ok) return false;
      try {
        await navigator.clipboard.writeText(result.markdown);
        setExportedId(id);
        if (exportTimer.current) clearTimeout(exportTimer.current);
        exportTimer.current = setTimeout(() => setExportedId(null), 1800);
        return true;
      } catch {
        setExportError("Could not copy exported Markdown to the clipboard.");
        return false;
      }
    },
    [controller],
  );

  const clearExportError = useCallback(() => setExportError(null), []);
  return { exportedId, exportError, exportMarkdown, clearExportError };
}

function useHistorySearchSync(
  controller: RefObject<AgentHistoryController | null>,
  query: string,
  setServerFiltered: (filtered: boolean) => void,
) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!nativeAvailable || !controller.current) return;
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const trimmed = query.trim();
    const timer = setTimeout(
      () => {
        void controller.current?.search(trimmed).then((ok) => {
          if (ok) setServerFiltered(trimmed.length > 0);
        });
      },
      trimmed.length > 0 ? 140 : 0,
    );
    return () => clearTimeout(timer);
  }, [controller, query, setServerFiltered]);
}

export function useAgentHistory({ onOpened }: { onOpened: (snapshot: AgentSnapshot) => void }) {
  const [history, setHistory] = useState<HistoryList>({ items: [], loading: false, error: null });
  const [query, setQuery] = useState("");
  const [serverFiltered, setServerFiltered] = useState(false);
  const controller = useRef<AgentHistoryController | null>(null);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const exportState = useHistoryExport(controller);
  useHistorySearchSync(controller, query, setServerFiltered);

  useEffect(() => {
    if (!nativeAvailable) return;
    const owner = new AgentHistoryController({
      list: searchAgentHistory,
      open: openAgentHistory,
      rename: renameAgentHistory,
      delete: deleteAgentHistory,
      deleteAll: deleteAllAgentHistory,
      exportMarkdown: exportAgentHistoryMarkdown,
      publish: setHistory,
    });
    controller.current = owner;
    return () => {
      owner.dispose();
      if (controller.current === owner) controller.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    exportState.clearExportError();
    await controller.current?.refresh(query);
    setServerFiltered(nativeAvailable && query.trim().length > 0);
  }, [exportState.clearExportError, query]);

  const open = useCallback(
    async (id: string) => {
      const owner = controller.current;
      if (!owner) return false;
      exportState.clearExportError();
      const result = await owner.open(id);
      if (result.state !== "ok" || controller.current !== owner) return false;
      onOpenedRef.current(result.snapshot);
      return true;
    },
    [exportState.clearExportError],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      exportState.clearExportError();
      return (await controller.current?.rename(id, title))?.ok ?? false;
    },
    [exportState.clearExportError],
  );

  const remove = useCallback(
    async (id: string) => {
      exportState.clearExportError();
      return (await controller.current?.delete(id))?.ok ?? false;
    },
    [exportState.clearExportError],
  );

  const removeAll = useCallback(async () => {
    exportState.clearExportError();
    return (await controller.current?.deleteAll())?.ok ?? false;
  }, [exportState.clearExportError]);

  return {
    conversations: history.items,
    query,
    setQuery,
    serverFiltered,
    exportedId: exportState.exportedId,
    pending: history.loading,
    error: exportState.exportError ?? history.error,
    refresh,
    open,
    rename,
    remove,
    removeAll,
    exportMarkdown: exportState.exportMarkdown,
  };
}
