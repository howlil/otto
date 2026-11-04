import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAgentHistory,
  deleteAllAgentHistory,
  listAgentHistory,
  nativeAvailable,
  openAgentHistory,
  renameAgentHistory,
  type AgentSnapshot,
} from "../../platform/tauri/agent";
import { AgentHistoryController, type HistoryList } from "./agent-history";

export function useAgentHistory({ onOpened }: { onOpened: (snapshot: AgentSnapshot) => void }) {
  const [history, setHistory] = useState<HistoryList>({
    items: [],
    loading: false,
    error: null,
  });
  const [query, setQuery] = useState("");
  const controller = useRef<AgentHistoryController | null>(null);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  useEffect(() => {
    if (!nativeAvailable) return;
    const owner = new AgentHistoryController({
      list: listAgentHistory,
      open: openAgentHistory,
      rename: renameAgentHistory,
      delete: deleteAgentHistory,
      deleteAll: deleteAllAgentHistory,
      publish: setHistory,
    });
    controller.current = owner;
    return () => {
      owner.dispose();
      if (controller.current === owner) controller.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    await controller.current?.refresh();
  }, []);

  const open = useCallback(async (id: string) => {
    const owner = controller.current;
    if (!owner) return false;
    const result = await owner.open(id);
    if (result.state !== "ok" || controller.current !== owner) return false;
    onOpenedRef.current(result.snapshot);
    return true;
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    return (await controller.current?.rename(id, title))?.ok ?? false;
  }, []);

  const remove = useCallback(async (id: string) => {
    return (await controller.current?.delete(id))?.ok ?? false;
  }, []);

  const removeAll = useCallback(async () => {
    return (await controller.current?.deleteAll())?.ok ?? false;
  }, []);

  return {
    conversations: history.items,
    query,
    setQuery,
    pending: history.loading,
    error: history.error,
    refresh,
    open,
    rename,
    remove,
    removeAll,
  };
}
