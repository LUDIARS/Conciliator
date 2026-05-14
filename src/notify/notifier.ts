import { basename } from "node:path";
import nodeNotifier from "node-notifier";
import { claimsRepo, collisionsRepo, workersRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { logger } from "../shared/logger.js";
import { newId, nowSec } from "../shared/ids.js";
import type { ClaimRow, Notification } from "../shared/types.js";

/**
 * 通知チャネル抽象。v0.1 は WS (Web UI) + デスクトップ通知。
 * v0.2 で Concordia チャットチャネルを足せるよう interface 化している (NFR6)。
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(n: Notification): void | Promise<void>;
}

/** WS チャネル: `notify` イベントをバスに流し、Web UI へブロードキャストさせる。 */
export class WsChannel implements NotificationChannel {
  readonly name = "ws";
  deliver(n: Notification): void {
    eventBus.emit({ type: "notify", notification: n });
  }
}

/** デスクトップ通知チャネル: OS ネイティブ通知を出す。 */
export class DesktopChannel implements NotificationChannel {
  readonly name = "desktop";
  deliver(n: Notification): void {
    try {
      nodeNotifier.notify({
        title: `Conciliator — ${n.title}`,
        message: n.body,
        wait: false,
      });
    } catch (err) {
      logger.warn({ err }, "desktop notification failed");
    }
  }
}

/**
 * Notifier: ドメインイベントを購読し、ユーザ向け通知を組み立てて各チャネルへ配る。
 */
export class Notifier {
  private readonly channels: NotificationChannel[];

  constructor(channels: NotificationChannel[]) {
    this.channels = channels;
  }

  start(): void {
    eventBus.on("collision.detected", (e) => {
      if (e.collision.phase === "pre") this.onPreCollision(e.collision.id);
    });
    eventBus.on("collision.updated", (e) => {
      if (e.collision.phase === "manifest") this.onManifestCollision(e.collision.id);
    });
    eventBus.on("structure.violated", (e) => {
      this.push({
        id: newId("ntf"),
        ts: nowSec(),
        severity: "medium",
        kind: "structure",
        title: "構成違反を検出",
        body: e.violation.detail,
        ref: { type: "structure_violation", id: e.violation.id },
      });
    });
    eventBus.on("risk.alerted", (e) => {
      this.push({
        id: newId("ntf"),
        ts: nowSec(),
        severity: e.alert.severity,
        kind: "risk",
        title: "危険操作を検出",
        body: `${e.alert.detail}\n対象: ${e.alert.path}`,
        ref: { type: "risk_alert", id: e.alert.id },
      });
    });
    eventBus.on("claim.created", (e) => {
      if (e.claim.intent_text == null) this.onIntentRequest(e.claim);
    });
    logger.info({ channels: this.channels.map((c) => c.name) }, "notifier started");
  }

  /** 通知を全チャネルへ配る。 */
  push(n: Notification): void {
    for (const ch of this.channels) {
      try {
        void ch.deliver(n);
      } catch (err) {
        logger.warn({ err, channel: ch.name }, "notification channel failed");
      }
    }
  }

  private onIntentRequest(claim: ClaimRow): void {
    const worker = workersRepo.get(claim.worker_id);
    this.push({
      id: newId("ntf"),
      ts: nowSec(),
      severity: "low",
      kind: "intent-request",
      title: "意思確認",
      body: `${worker?.label ?? "作業者"} さん: ${basename(claim.path)} で何をしていますか？`,
      ref: { type: "claim", id: claim.id },
    });
  }

  private onPreCollision(collisionId: string): void {
    const collision = this.lookupCollision(collisionId);
    if (!collision) return;
    const { peerLabel, intent, path, newWorkerLabel } = collision;
    const intentLine = intent ? `\n${peerLabel} の意図: ${intent}` : "";
    this.push({
      id: newId("ntf"),
      ts: nowSec(),
      severity: "medium",
      kind: "pre-collision",
      title: "作業の重複 (事前)",
      body:
        `${newWorkerLabel} さん: ${basename(path)} は ${peerLabel} が作業中です。` +
        `先に調整してください。${intentLine}`,
      ref: { type: "collision", id: collisionId },
    });
  }

  private onManifestCollision(collisionId: string): void {
    const collision = this.lookupCollision(collisionId);
    if (!collision) return;
    const { peerLabel, path, newWorkerLabel } = collision;
    this.push({
      id: newId("ntf"),
      ts: nowSec(),
      severity: "high",
      kind: "manifest-collision",
      title: "衝突が発生",
      body:
        `${basename(path)} を ${peerLabel} と ${newWorkerLabel} が両方更新しました。` +
        `クレバーマージで差分を確認してください。`,
      ref: { type: "collision", id: collisionId },
    });
  }

  private lookupCollision(collisionId: string): {
    path: string;
    peerLabel: string;
    newWorkerLabel: string;
    intent: string | null;
  } | null {
    const collision = collisionsRepo.get(collisionId);
    if (!collision) return null;
    const claimA = claimsRepo.get(collision.claim_a);
    const claimB = claimsRepo.get(collision.claim_b);
    const peer = claimA ? workersRepo.get(claimA.worker_id) : undefined;
    const newer = claimB ? workersRepo.get(claimB.worker_id) : undefined;
    return {
      path: collision.path,
      peerLabel: peer?.label ?? "別の作業者",
      newWorkerLabel: newer?.label ?? "別の作業者",
      intent: claimA?.intent_text ?? null,
    };
  }
}
