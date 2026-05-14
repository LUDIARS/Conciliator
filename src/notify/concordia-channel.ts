import type { NotificationChannel } from "./notifier.js";
import type { ConcordiaConfig } from "../shared/config-types.js";
import type { Notification } from "../shared/types.js";
import { logger } from "../shared/logger.js";

/**
 * Concordia チャットへ通知を流すチャネル (v0.2 機能、config.concordia があれば有効)。
 * Concordia の `POST /v1/chat` に投稿する。通知レイヤを抽象化した NFR6 の実証。
 */
export class ConcordiaChannel implements NotificationChannel {
  readonly name = "concordia";

  constructor(private readonly cfg: ConcordiaConfig) {}

  async deliver(n: Notification): Promise<void> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/v1/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: this.cfg.channel,
          author_label: this.cfg.authorLabel,
          text: `[Conciliator/${n.kind}] ${n.title}\n${n.body}`,
        }),
      });
      if (!res.ok) logger.warn({ status: res.status }, "concordia chat post non-ok");
    } catch (err) {
      logger.warn({ err }, "concordia notification failed (Concordia 未起動の可能性)");
    }
  }
}
