import { useCallback, useEffect, useRef, useState } from "react";
import { wsClient } from "./ws";

/**
 * fetcher を初回 + 指定 WS イベント type 受信時に再実行するフック。
 * refreshOn が空配列なら全イベントで再取得する。
 */
export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  refreshOn: string[] = [],
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => {
    fetcherRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    reload();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = wsClient.on((event: { type?: string }) => {
      if (refreshOn.length > 0 && (!event.type || !refreshOn.includes(event.type))) return;
      // 連続イベントをまとめて 1 回再取得
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, refreshOn.join(",")]);

  return { data, error, reload };
}

/** WS 接続状態 (up/down)。 */
export function useWsStatus(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => wsClient.onStatus(setUp), []);
  return up;
}
