import { createHmac, timingSafeEqual } from "node:crypto";
import type { CernereConfig } from "../shared/config-types.js";

/** Cernere トークンの payload (sub = ユーザ id)。 */
export interface CernereTokenPayload {
  sub: string;
  projectId?: string;
  label?: string;
  host?: string;
  exp?: number;
  [k: string]: unknown;
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Cernere が発行する HMAC-SHA256 署名済みトークン (JWT 形式) をローカル検証する。
 * Cernere は /auth しか公開しないため、各サービスは共有 HMAC secret でローカル検証する
 * (LUDIARS の慣行 — per-user / memory-only secret)。
 */
export function verifyCernereToken(token: string, hmacSecret: string): CernereTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", hmacSecret).update(`${h}.${p}`).digest();
  const actual = b64urlDecode(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("signature mismatch");
  }
  const payload = JSON.parse(b64urlDecode(p).toString("utf8")) as CernereTokenPayload;
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("token expired");
  if (!payload.sub) throw new Error("token has no sub claim");
  return payload;
}

/**
 * Cernere 認証クライアント。
 * - server 側: agent から受け取った project-token をローカル検証する
 * - agent 側: 対話ログイン済みの accessToken から per-project token を取得する
 */
export class CernereClient {
  constructor(private readonly cfg: CernereConfig) {}

  private hmacSecret(): string {
    const secret = process.env[this.cfg.hmacSecretEnv];
    if (!secret) {
      throw new Error(
        `Cernere HMAC secret 未設定: 環境変数 ${this.cfg.hmacSecretEnv} を設定してください`,
      );
    }
    return secret;
  }

  /** server 側: agent の project-token を検証して payload を返す。 */
  verify(token: string): CernereTokenPayload {
    return verifyCernereToken(token, this.hmacSecret());
  }

  /**
   * agent 側: accessToken (対話ログイン済み) から per-project token を取得する。
   * Cernere の `/api/auth/project-token` (per-user × per-project) を叩く。
   */
  async getProjectToken(accessToken: string): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/api/auth/project-token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: this.cfg.projectId }),
    });
    if (!res.ok) {
      throw new Error(`Cernere project-token 取得失敗: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { token?: string; accessToken?: string };
    const token = json.token ?? json.accessToken;
    if (!token) throw new Error("Cernere project-token レスポンスに token がありません");
    return token;
  }
}
