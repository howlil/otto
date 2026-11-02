import { useCallback, useRef, useState } from "react";
import {
  deleteAgentHistory,
  listAgentHistory,
  nativeAvailable,
  openAgentHistory,
  renameAgentHistory,
  type AgentConversationSummary,
  type AgentSnapshot,
} from "../../platform/tauri";
import { normalizeTitle } from "./history-model";

export function useAgentHistory({ onOpened }: { onOpened: (snapshot: AgentSnapshot) => void }) {
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const begin = useCallback(() => {
    if (!nativeAvailable || busy.current) return false;
    busy.current = true;
    setPending(true);
    return true;
  }, []);
  const finish = useCallback(() => {
    busy.current = false;
    setPending(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!begin()) return;
    try {
      setConversations(await listAgentHistory());
      setError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      finish();
    }
  }, [begin, finish]);

  const open = useCallback(
    async (id: string) => {
      if (!begin()) return false;
      try {
        onOpened(await openAgentHistory(id));
        setError(null);
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        finish();
      }
    },
    [begin, finish, onOpened],
  );

  const rename = useCallback(
    async (id: string, rawTitle: string) => {
      const title = normalizeTitle(rawTitle);
      if (!title || !begin()) return false;
      try {
        await renameAgentHistory(id, title);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === id ? { ...conversation, title } : conversation,
          ),
        );
        setError(null);
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        finish();
      }
    },
    [begin, finish],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!begin()) return false;
      try {
        await deleteAgentHistory(id);
        setConversations((current) => current.filter((conversation) => conversation.id !== id));
        setError(null);
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        finish();
      }
    },
    [begin, finish],
  );

  return { conversations, query, setQuery, pending, error, refresh, open, rename, remove };
}
