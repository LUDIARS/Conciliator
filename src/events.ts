import { EventEmitter } from "node:events";
import type {
  ClaimRow,
  CollisionRow,
  FileChangeKind,
  FileEventRow,
  Notification,
  RiskAlertRow,
  StructureViolationRow,
} from "./shared/types.js";

/**
 * イベントの発生元。local = この Conciliator が直接監視 / agent = 遠隔 agent からの転送。
 */
export type EventSource =
  | { kind: "local" }
  | {
      kind: "agent";
      agentId: string;
      cernereUserId: string;
      host: string;
      label: string;
    };

/**
 * in-process pub/sub イベントバス。全コンポーネントがここを経由して疎結合に連携する。
 * (Concordia src/events.ts と同じパターン)
 */
export type ConciliatorEvent =
  /** Watcher: バイナリ glob にマッチしたファイルの変更 */
  | {
      type: "file.changed";
      rootId: string;
      path: string;
      kind: FileChangeKind;
      ts: number;
      sizeBytes?: number;
      hash?: string;
      source?: EventSource;
    }
  /** Watcher: Office ロックファイルの出現 → 対象ファイルを誰かが開いた */
  | {
      type: "lockfile.opened";
      rootId: string;
      targetPath: string;
      lockPath: string;
      owner: string | null;
      ts: number;
      source?: EventSource;
    }
  /** Watcher: Office ロックファイルの消滅 → 対象ファイルが閉じられた */
  | {
      type: "lockfile.closed";
      rootId: string;
      targetPath: string;
      lockPath: string;
      ts: number;
      source?: EventSource;
    }
  /** agent が server に接続 / 切断した */
  | { type: "agent.connected"; agentId: string; cernereUserId: string; host: string; ts: number }
  | { type: "agent.disconnected"; agentId: string; ts: number }
  /** ファイルイベントが DB に永続化された (Risk/Structure エンジンが購読) */
  | { type: "file.persisted"; row: FileEventRow }
  | { type: "claim.created"; claim: ClaimRow }
  | { type: "claim.updated"; claim: ClaimRow }
  | { type: "claim.released"; claim: ClaimRow }
  | { type: "collision.detected"; collision: CollisionRow }
  | { type: "collision.updated"; collision: CollisionRow }
  | { type: "structure.violated"; violation: StructureViolationRow }
  | { type: "risk.alerted"; alert: RiskAlertRow }
  | { type: "config.reloaded"; ts: number }
  /** Notifier がユーザへ届ける通知 (WS で Web UI にも流す) */
  | { type: "notify"; notification: Notification };

export type ConciliatorEventType = ConciliatorEvent["type"];

class ConciliatorEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: ConciliatorEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  /** 特定 type を購読。unsubscribe 関数を返す。 */
  on<T extends ConciliatorEventType>(
    type: T,
    handler: (event: Extract<ConciliatorEvent, { type: T }>) => void,
  ): () => void {
    const wrapped = (e: ConciliatorEvent) => handler(e as Extract<ConciliatorEvent, { type: T }>);
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }

  /** 全イベントを購読 (WS ブロードキャスト用)。 */
  onAny(handler: (event: ConciliatorEvent) => void): () => void {
    this.emitter.on("*", handler);
    return () => this.emitter.off("*", handler);
  }
}

export const eventBus = new ConciliatorEventBus();
