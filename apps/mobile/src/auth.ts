// Google の OAuth(認可コード + PKCE)でログインする。クライアントは種類 Android で、client secret を持たない。
// ログインの画面は OS のブラウザで開き、パッケージ名のスキームで戻る(docs/設計メモ.md の「OAuth のスコープ」)。
// トークンは端末の安全な保管場所に置き、アクセストークンの期限が近づいたらリフレッシュトークンで更新する
import {
  AuthRequest,
  type DiscoveryDocument,
  exchangeCodeAsync,
  Prompt,
  refreshAsync,
  revokeAsync,
  TokenError,
  TokenResponse,
  type TokenResponseConfig,
} from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { config } from "./config.ts";

// 1つの鍵にまとめて、書きかけの組み合わせが残らないようにする。ID トークンは置かない(メールだけ取り出す)
const STORAGE_KEY = "auth.session";

// 保管場所の削除を試す回数と間隔(ミリ秒)
const DELETE_ATTEMPTS = 3;
const DELETE_RETRY_MS = 200;

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SCOPES = [SHEETS_SCOPE, "openid", "email"];

// Google の窓口は決まっているので、発行元の情報を取りに行かない(起動とログアウトの通信を減らす)
const DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// app.config.ts の scheme に足してある
const REDIRECT_URI = "io.github.inouedaiki.shoppinglist:/oauth2redirect";

const NOT_CONFIGURED = "Google のクライアント ID が設定されていません。GOOGLE_OAUTH_CLIENT_ID を設定してビルドし直してください。";
const SIGN_IN_FAILED = "ログインできませんでした。";
const SCOPE_DENIED = "スプレッドシートへのアクセスが許可されませんでした。もう一度ログインして許可してください。";
const LOGIN_EXPIRED = "ログインの期限が切れました。ログインし直してください。";

export interface SignedInUser {
  email?: string;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "signingIn" }
  | { status: "signedIn"; user: SignedInUser };

interface Session {
  token: TokenResponse;
  user: SignedInUser;
}

// ログインが要る。画面はログインへ案内する(通信の失敗はこのエラーにしない)
export class LoginRequiredError extends Error {
  override name = "LoginRequiredError";
  constructor() {
    super("ログインが必要です");
  }
}

// ID トークンのメール(署名は確かめない。トークンの窓口から直接受け取ったもので、表示にだけ使う)
function userOf(idToken: string | undefined): SignedInUser {
  try {
    const part = (idToken ?? "").split(".")[1] ?? "";
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const { email } = JSON.parse(atob(base64)) as { email?: unknown };
    return typeof email === "string" ? { email } : {};
  } catch {
    return {};
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AuthStore {
  state: AuthState = { status: "loading" };
  private session: Session | undefined;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | undefined;
  // 同時に何度も更新しないよう、更新中の Promise を共有する
  private refreshing: Promise<TokenResponse> | undefined;
  // ログインを終えるたびに増やす。前の世代のログインや更新は、結果を捨てる(トークンを復活させない)
  private generation = 0;
  // 保管場所への読み書きを順に行う(書いている途中のトークンが、消した後に残らないように)
  private storage: Promise<unknown> = Promise.resolve();

  // useSyncExternalStore に渡す。最初の購読で保管したトークンを読む
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.load();
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AuthState => this.state;

  private set(state: AuthState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.storage.then(task, task);
    this.storage = run.catch(() => undefined);
    return run;
  }

  // 保管したトークンを読む。何度呼んでも読むのは1回
  load(): Promise<void> {
    this.loading ??= this.restore();
    return this.loading;
  }

  private async restore(): Promise<void> {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (!stored) {
        this.set({ status: "signedOut" });
        return;
      }
      const { token, user } = JSON.parse(stored) as { token: TokenResponseConfig; user: SignedInUser };
      this.session = { token: new TokenResponse(token), user };
      this.set({ status: "signedIn", user });
    } catch (e) {
      console.warn("保管したトークンを読めなかった", e);
      this.set({ status: "signedOut" });
    }
  }

  async signIn(): Promise<void> {
    await this.load();
    if (this.state.status !== "signedOut") {
      return;
    }
    const clientId = config.googleOAuthClientId;
    if (!clientId) {
      this.set({ status: "signedOut", error: NOT_CONFIGURED });
      return;
    }
    const generation = this.generation;
    this.set({ status: "signingIn" });
    // 途中でログアウトしたら、後の状態に触らない
    const fail = (error?: string) => {
      if (generation === this.generation) {
        this.set({ status: "signedOut", error });
      }
    };
    try {
      const request = new AuthRequest({
        clientId,
        redirectUri: REDIRECT_URI,
        scopes: SCOPES,
        usePKCE: true,
        // リフレッシュトークンを確実に受け取る
        prompt: Prompt.Consent,
        extraParams: { access_type: "offline" },
      });
      const result = await request.promptAsync(DISCOVERY);
      if (result.type !== "success") {
        if (result.type === "error") {
          console.warn("ログインの画面がエラーを返した", result.error);
        }
        fail(result.type === "error" ? SIGN_IN_FAILED : undefined);
        return;
      }
      const token = await exchangeCodeAsync(
        {
          clientId,
          code: String(result.params.code),
          redirectUri: REDIRECT_URI,
          extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
        },
        DISCOVERY,
      );
      // 同意の画面ではスコープごとに外せる。外されるとシートに触れないので、ログインにしない
      if (token.scope && !token.scope.split(" ").includes(SHEETS_SCOPE)) {
        void this.revoke(token.refreshToken ?? token.accessToken);
        fail(SCOPE_DENIED);
        return;
      }
      const user = userOf(token.idToken);
      let saved: boolean;
      try {
        saved = await this.save({ token, user }, generation);
      } catch (e) {
        // 保管できなかった。トークンを持たないままログインを終える
        console.warn("トークンを保管できなかった", e);
        await this.endSession({ status: "signedOut", error: SIGN_IN_FAILED });
        void this.revoke(token.refreshToken ?? token.accessToken);
        return;
      }
      if (!saved) {
        void this.revoke(token.refreshToken ?? token.accessToken);
        return;
      }
      this.set({ status: "signedIn", user });
    } catch (e) {
      console.warn("ログインできなかった", e);
      fail(SIGN_IN_FAILED);
    }
  }

  // ログインを終える。通信中の更新を無効にしてから、保管したトークンを消す
  private async endSession(state: AuthState): Promise<void> {
    this.generation += 1;
    this.session = undefined;
    this.refreshing = undefined;
    this.set(state);
    await this.purge();
  }

  // 保管したトークンを消す。失敗しても投げない(ログアウトの続きを止めない)
  private purge(): Promise<void> {
    return this.serial(async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await SecureStore.deleteItemAsync(STORAGE_KEY);
          return;
        } catch (e) {
          if (attempt === DELETE_ATTEMPTS) {
            console.warn("保管したトークンを消せなかった", e);
            return;
          }
        }
        await delay(DELETE_RETRY_MS);
      }
    });
  }

  // トークンを取り消す。届かなくてもログアウトは止めない(トークンは端末から消えている)
  private async revoke(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }
    try {
      await revokeAsync({ token, clientId: config.googleOAuthClientId }, DISCOVERY);
    } catch (e) {
      console.info("トークンを取り消せなかった", e);
    }
  }

  async signOut(): Promise<void> {
    await this.load();
    const token = this.session?.token;
    await this.endSession({ status: "signedOut" });
    void this.revoke(token?.refreshToken ?? token?.accessToken);
  }

  // Sheets API の呼び出しに付けるアクセストークン。期限が近ければ更新する。
  // ログインが切れていれば LoginRequiredError を投げる(通信の失敗はそのまま投げ、ログインを保つ)
  // forceRefresh は、Sheets API が 401 を返したときに、期限の前でも取り直す
  async getAccessToken({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<string> {
    await this.load();
    const session = this.session;
    if (!session) {
      throw new LoginRequiredError();
    }
    const { token } = session;
    if ((forceRefresh || token.shouldRefresh()) && token.refreshToken) {
      return (await this.refresh(session)).accessToken;
    }
    // リフレッシュトークンが無いまま期限が切れた。更新できないので、ログインし直してもらう
    if (!TokenResponse.isTokenFresh(token, 0)) {
      await this.endSession({ status: "signedOut", error: LOGIN_EXPIRED });
      throw new LoginRequiredError();
    }
    return token.accessToken;
  }

  private refresh({ token, user }: Session): Promise<TokenResponse> {
    const generation = this.generation;
    this.refreshing ??= (async () => {
      try {
        const next = await refreshAsync({ clientId: config.googleOAuthClientId, refreshToken: token.refreshToken }, DISCOVERY);
        // Google の更新の応答にはリフレッシュトークンが無いので、前のものを使い続ける
        next.refreshToken ??= token.refreshToken;
        if (!(await this.save({ token: next, user }, generation))) {
          // 更新の通信中にログアウトした。下の catch で LoginRequiredError にする
          throw new Error("ログアウトしたので、トークンの更新を取りやめた");
        }
        return next;
      } catch (e) {
        // ログアウトの後に届いた失敗は、次の人のログインに触らない
        if (generation !== this.generation) {
          throw new LoginRequiredError();
        }
        // サーバーが断ったとき(取り消し、失効)だけログインし直してもらう。
        // 電波が切れたなどで届かなかったときは、ログインを保ち、次の呼び出しで更新し直す
        if (e instanceof TokenError && e.code === "invalid_grant") {
          console.info("リフレッシュトークンが断られた", e);
          await this.endSession({ status: "signedOut", error: LOGIN_EXPIRED });
          throw new LoginRequiredError();
        }
        console.warn("トークンを更新できなかった", e);
        throw e;
      } finally {
        if (generation === this.generation) {
          this.refreshing = undefined;
        }
      }
    })();
    return this.refreshing;
  }

  // generation の世代のログインがまだ続いているときだけ置く。置いたら true
  private save(session: Session, generation: number): Promise<boolean> {
    return this.serial(async () => {
      if (generation !== this.generation) {
        return false;
      }
      const { token, user } = session;
      this.session = session;
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ token: { ...token.getRequestConfig(), idToken: undefined }, user }));
      return true;
    });
  }
}

export const auth = new AuthStore();

// packages/sheets の client に渡す
export function getAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  return auth.getAccessToken(options);
}

// 失敗は投げず、useAuth の signedOut の error に出す
export function signIn(): Promise<void> {
  return auth.signIn();
}

export function signOut(): Promise<void> {
  return auth.signOut();
}

// ログインの状態を読み、変わったら描き直す
export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot);
}
