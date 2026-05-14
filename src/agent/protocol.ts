import type { FileChangeKind, Notification } from "../shared/types.js";

/** agent ↔ server の WS メッセージ契約。 */

export type AgentToServer =
  /** 接続直後の認証ハンドシェイク。token は Cernere の project-token。 */
  | { type: "agent.hello"; token: string; agentId: string; host: string }
  /** claim の baseline 用にファイル内容を先行アップロードする。 */
  | { type: "agent.snapshot"; path: string; contentBase64: string }
  | {
      type: "file.changed";
      rootId: string;
      path: string;
      kind: FileChangeKind;
      ts: number;
      sizeBytes?: number;
      hash?: string;
    }
  | {
      type: "lockfile.opened";
      rootId: string;
      targetPath: string;
      lockPath: string;
      owner: string | null;
      ts: number;
    }
  | { type: "lockfile.closed"; rootId: string; targetPath: string; lockPath: string; ts: number };

export type ServerToAgent =
  | { type: "agent.welcome"; cernereUserId: string }
  | { type: "agent.error"; message: string }
  | { type: "notify"; notification: Notification };
