// バックエンドの /ws に繋ぐシングルトン WebSocket クライアント。
// 全イベントをリスナへブロードキャストし、切断時は指数バックオフで再接続する。

type WsListener = (event: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private statusListeners = new Set<(up: boolean) => void>();
  private backoff = 500;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.statusListeners.forEach((l) => l(true));
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        this.listeners.forEach((l) => l(data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.statusListeners.forEach((l) => l(false));
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    };
    ws.onerror = () => ws.close();
  }

  on(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (up: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
}

export const wsClient = new WsClient();
