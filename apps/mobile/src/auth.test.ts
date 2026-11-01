import { beforeEach, describe, expect, it, vi } from "vitest";

// 端末の保管場所の代わり
const store = new Map<string, string>();
const KEY = "auth.session";
const mocks = vi.hoisted(() => ({
  refreshAsync: vi.fn(),
  revokeAsync: vi.fn(),
  exchangeCodeAsync: vi.fn(),
  promptAsync: vi.fn(),
  authRequest: vi.fn(),
  config: { googleOAuthClientId: "test-client" },
}));

vi.mock("expo-auth-session", () => {
  class TokenResponse {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    scope?: string;
    constructor(config: { accessToken: string; idToken?: string; refreshToken?: string; scope?: string }) {
      this.accessToken = config.accessToken;
      this.idToken = config.idToken;
      this.refreshToken = config.refreshToken;
      this.scope = config.scope;
    }
    shouldRefresh() {
      return this.accessToken.startsWith("old");
    }
    static isTokenFresh(token: TokenResponse) {
      return !token.accessToken.startsWith("expired");
    }
    getRequestConfig() {
      return { accessToken: this.accessToken, idToken: this.idToken, refreshToken: this.refreshToken, scope: this.scope };
    }
  }
  class TokenError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  class AuthRequest {
    codeVerifier = "verifier";
    promptAsync = mocks.promptAsync;
    constructor(config: unknown) {
      mocks.authRequest(config);
    }
  }
  return {
    AuthRequest,
    Prompt: { Consent: "consent" },
    TokenError,
    TokenResponse,
    exchangeCodeAsync: mocks.exchangeCodeAsync,
    refreshAsync: mocks.refreshAsync,
    revokeAsync: mocks.revokeAsync,
  };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (listener: () => void) => void, getSnapshot: () => unknown) => {
    subscribe(() => undefined);
    return getSnapshot();
  },
}));
vi.mock("./config.ts", () => ({ config: mocks.config }));

const SHEETS = "https://www.googleapis.com/auth/spreadsheets";
const SCOPE = `openid ${SHEETS} https://www.googleapis.com/auth/userinfo.email`;
const LOGIN_EXPIRED = "ログインの期限が切れました。ログインし直してください。";

function idToken(email: string): string {
  return `header.${btoa(JSON.stringify({ email }))}.sig`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seed(accessToken = "fresh", refreshToken: string | undefined = "refresh-a") {
  store.set(KEY, JSON.stringify({ token: { accessToken, refreshToken }, user: { email: "a@example.com" } }));
}

async function load() {
  const { auth, ...rest } = await import("./auth.ts");
  await auth.load();
  return { auth, ...rest };
}

// Google が同意の後に返すトークンを用意する
async function grant(config: { accessToken?: string; refreshToken?: string; scope?: string; idToken?: string } = {}) {
  const { TokenResponse } = await import("expo-auth-session");
  mocks.promptAsync.mockResolvedValue({ type: "success", params: { code: "code" } });
  mocks.exchangeCodeAsync.mockResolvedValue(
    new TokenResponse({
      accessToken: "fresh",
      refreshToken: "refresh-b",
      scope: SCOPE,
      idToken: idToken("b@example.com"),
      ...config,
    }),
  );
}

// vi.resetModules で読み込み直すので、instanceof ではなく name で見る
describe("auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    store.clear();
    mocks.config.googleOAuthClientId = "test-client";
    mocks.revokeAsync.mockResolvedValue(true);
  });

  describe("ログイン", () => {
    it("認可コード + PKCE で、リフレッシュトークンを得る指定で開き、トークンを保管する", async () => {
      const { auth, signIn } = await load();
      await grant();

      await signIn();

      const request = mocks.authRequest.mock.calls[0]![0];
      expect(request).toMatchObject({
        clientId: "test-client",
        redirectUri: "io.github.inouedaiki.shoppinglist:/oauth2redirect",
        scopes: [SHEETS, "openid", "email"],
        usePKCE: true,
        prompt: "consent",
        extraParams: { access_type: "offline" },
      });
      expect(request).not.toHaveProperty("clientSecret");
      expect(mocks.promptAsync.mock.calls[0]![0]).toMatchObject({
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      });
      expect(mocks.exchangeCodeAsync.mock.calls[0]![0]).toEqual({
        clientId: "test-client",
        code: "code",
        redirectUri: "io.github.inouedaiki.shoppinglist:/oauth2redirect",
        extraParams: { code_verifier: "verifier" },
      });
      expect(auth.state).toEqual({ status: "signedIn", user: { email: "b@example.com" } });
      const saved = JSON.parse(store.get(KEY)!);
      expect(saved.token).toMatchObject({ accessToken: "fresh", refreshToken: "refresh-b" });
      expect(saved.token).not.toHaveProperty("idToken");
    });

    it("保管したログインを、次の起動で読める", async () => {
      const first = await load();
      await grant();
      await first.signIn();

      vi.resetModules();
      const { auth, getAccessToken } = await import("./auth.ts");
      await expect(getAccessToken()).resolves.toBe("fresh");
      expect(auth.state).toEqual({ status: "signedIn", user: { email: "b@example.com" } });
    });

    it("クライアント ID が空なら、ブラウザを開かず、設定されていないと伝える", async () => {
      mocks.config.googleOAuthClientId = "";
      const { auth, signIn } = await load();

      await signIn();

      expect(auth.state).toMatchObject({ status: "signedOut", error: expect.stringContaining("設定されていません") });
      expect(mocks.promptAsync).not.toHaveBeenCalled();
    });

    it("閉じられたらエラーにしない", async () => {
      const { auth, signIn } = await load();
      mocks.promptAsync.mockResolvedValue({ type: "cancel" });
      await signIn();
      expect(auth.state).toEqual({ status: "signedOut" });
    });

    it("ログインの画面のエラーと、コードの交換の失敗は、ログインせずに伝える", async () => {
      const { auth, signIn } = await load();
      mocks.promptAsync.mockResolvedValue({ type: "error", error: new Error("access_denied") });
      await signIn();
      expect(auth.state).toEqual({ status: "signedOut", error: "ログインできませんでした。" });

      await grant();
      mocks.exchangeCodeAsync.mockRejectedValue(new Error("圏外"));
      await signIn();
      expect(auth.state).toEqual({ status: "signedOut", error: "ログインできませんでした。" });
      expect(store.size).toBe(0);
    });

    it("スプレッドシートのスコープを外されたら、ログインにせず、受け取ったトークンを取り消す", async () => {
      const { auth, signIn } = await load();
      await grant({ scope: "openid email" });

      await signIn();

      expect(auth.state).toMatchObject({ status: "signedOut", error: expect.stringContaining("スプレッドシート") });
      expect(store.size).toBe(0);
      await vi.waitFor(() =>
        expect(mocks.revokeAsync).toHaveBeenCalledWith({ token: "refresh-b", clientId: "test-client" }, expect.anything()),
      );
    });

    it("ログインの最中に重ねて呼んでも、ブラウザを2回開かない", async () => {
      const { signIn } = await load();
      await grant();
      await Promise.all([signIn(), signIn()]);
      expect(mocks.promptAsync).toHaveBeenCalledOnce();
    });

    it("トークンを保管できなければ、ログインにせず、トークンを取り消す", async () => {
      const { auth, signIn, getAccessToken } = await load();
      await grant();
      const SecureStore = await import("expo-secure-store");
      vi.spyOn(SecureStore, "setItemAsync").mockRejectedValueOnce(new Error("Keystore"));

      await signIn();

      expect(auth.state).toEqual({ status: "signedOut", error: "ログインできませんでした。" });
      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
      await vi.waitFor(() => expect(mocks.revokeAsync).toHaveBeenCalledOnce());
    });

    it("ログインの最中にログアウトしたら、届いたトークンを捨てる", async () => {
      const { auth, signIn, signOut } = await load();
      await grant();
      const prompt = deferred<unknown>();
      mocks.promptAsync.mockReturnValue(prompt.promise);

      const pending = signIn();
      await vi.waitFor(() => expect(mocks.promptAsync).toHaveBeenCalled());
      await signOut();
      prompt.resolve({ type: "success", params: { code: "code" } });
      await pending;

      expect(auth.state).toEqual({ status: "signedOut" });
      expect(store.size).toBe(0);
      await vi.waitFor(() => expect(mocks.revokeAsync).toHaveBeenCalledOnce());
    });
  });

  describe("アクセストークン", () => {
    it("期限が遠ければ、通信せずに返す", async () => {
      seed();
      const { getAccessToken } = await import("./auth.ts");
      await expect(getAccessToken()).resolves.toBe("fresh");
      expect(mocks.refreshAsync).not.toHaveBeenCalled();
    });

    it("forceRefresh なら、期限が遠くても更新する", async () => {
      seed();
      const { TokenResponse } = await import("expo-auth-session");
      mocks.refreshAsync.mockResolvedValue(new TokenResponse({ accessToken: "fresh-next" }));
      const { getAccessToken } = await load();
      await expect(getAccessToken({ forceRefresh: true })).resolves.toBe("fresh-next");
    });

    it("ログインしていなければ LoginRequiredError を投げる", async () => {
      const { getAccessToken } = await import("./auth.ts");
      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
    });

    it("期限が近ければ1回だけ更新し、前のリフレッシュトークンを使い続ける", async () => {
      seed("old");
      const { TokenResponse } = await import("expo-auth-session");
      mocks.refreshAsync.mockResolvedValue(new TokenResponse({ accessToken: "fresh-next" }));
      const { auth, getAccessToken } = await load();

      await expect(Promise.all([getAccessToken(), getAccessToken()])).resolves.toEqual(["fresh-next", "fresh-next"]);

      expect(mocks.refreshAsync).toHaveBeenCalledOnce();
      expect(mocks.refreshAsync.mock.calls[0]![0]).toEqual({ clientId: "test-client", refreshToken: "refresh-a" });
      expect(JSON.parse(store.get(KEY)!).token).toMatchObject({ accessToken: "fresh-next", refreshToken: "refresh-a" });
      expect(auth.state).toEqual({ status: "signedIn", user: { email: "a@example.com" } });
    });

    it("invalid_grant のときだけ、ログインを終えて LoginRequiredError を投げる", async () => {
      seed("old");
      const { TokenError } = await import("expo-auth-session");
      mocks.refreshAsync.mockRejectedValue(new (TokenError as unknown as new (code: string) => Error)("invalid_grant"));
      const { auth, getAccessToken } = await load();

      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
      expect(auth.state).toEqual({ status: "signedOut", error: LOGIN_EXPIRED });
      expect(store.size).toBe(0);
    });

    it("通信の失敗とほかのトークンのエラーはそのまま投げ、ログインを保つ", async () => {
      seed("old");
      const { TokenError, TokenResponse } = await import("expo-auth-session");
      const { auth, getAccessToken } = await load();

      const offline = new Error("圏外");
      mocks.refreshAsync.mockRejectedValueOnce(offline);
      await expect(getAccessToken()).rejects.toBe(offline);

      const server = new (TokenError as unknown as new (code: string) => Error)("temporarily_unavailable");
      mocks.refreshAsync.mockRejectedValueOnce(server);
      await expect(getAccessToken()).rejects.toBe(server);

      expect(auth.state.status).toBe("signedIn");
      expect(JSON.parse(store.get(KEY)!).token.refreshToken).toBe("refresh-a");

      // 電波が戻れば、次の呼び出しで更新できる
      mocks.refreshAsync.mockResolvedValueOnce(new TokenResponse({ accessToken: "fresh-next" }));
      await expect(getAccessToken()).resolves.toBe("fresh-next");
    });

    it("リフレッシュトークンが無いまま期限が切れたら、ログインを終えて LoginRequiredError を投げる", async () => {
      store.set(KEY, JSON.stringify({ token: { accessToken: "expired" }, user: {} }));
      const { auth, getAccessToken } = await load();

      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
      expect(auth.state).toEqual({ status: "signedOut", error: LOGIN_EXPIRED });
      expect(store.size).toBe(0);
    });

    it("更新の通信中にログアウトしても、トークンを復活させない", async () => {
      seed("old");
      const { TokenResponse } = await import("expo-auth-session");
      const response = deferred<InstanceType<typeof TokenResponse>>();
      mocks.refreshAsync.mockReturnValue(response.promise);
      const { getAccessToken, signOut } = await load();

      const pending = getAccessToken();
      await vi.waitFor(() => expect(mocks.refreshAsync).toHaveBeenCalled());
      await signOut();
      response.resolve(new TokenResponse({ accessToken: "fresh-next", refreshToken: "refresh-next" }));

      await expect(pending).rejects.toMatchObject({ name: "LoginRequiredError" });
      expect(store.size).toBe(0);
      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
    });

    it("前のログインの更新の失敗は、次の状態に触らない", async () => {
      seed("old");
      const { TokenError } = await import("expo-auth-session");
      const response = deferred<never>();
      mocks.refreshAsync.mockReturnValue(response.promise);
      const { auth, getAccessToken, signOut } = await load();

      const pending = getAccessToken();
      await vi.waitFor(() => expect(mocks.refreshAsync).toHaveBeenCalled());
      await signOut();
      response.reject(new (TokenError as unknown as new (code: string) => Error)("invalid_grant"));

      await expect(pending).rejects.toMatchObject({ name: "LoginRequiredError" });
      expect(auth.state).toEqual({ status: "signedOut" });
    });
  });

  describe("ログアウト", () => {
    it("リフレッシュトークンを取り消し、保管したトークンを消す", async () => {
      seed();
      const { auth, signOut } = await load();

      await signOut();

      expect(auth.state).toEqual({ status: "signedOut" });
      expect(store.size).toBe(0);
      await vi.waitFor(() =>
        expect(mocks.revokeAsync).toHaveBeenCalledWith(
          { token: "refresh-a", clientId: "test-client" },
          expect.objectContaining({ revocationEndpoint: "https://oauth2.googleapis.com/revoke" }),
        ),
      );
    });

    it("取り消しに失敗しても終わる", async () => {
      seed();
      mocks.revokeAsync.mockRejectedValue(new Error("圏外"));
      const { auth, signOut } = await load();

      await expect(signOut()).resolves.toBeUndefined();

      expect(auth.state).toEqual({ status: "signedOut" });
      expect(store.size).toBe(0);
    });

    it("保管場所の削除が一度失敗しても、やり直して消す", async () => {
      seed();
      const { auth, signOut } = await load();
      const SecureStore = await import("expo-secure-store");
      vi.spyOn(SecureStore, "deleteItemAsync").mockRejectedValueOnce(new Error("Keystore"));

      await signOut();

      expect(auth.state).toEqual({ status: "signedOut" });
      expect(store.size).toBe(0);
    });

    it("保管場所から消せなくても、状態はログアウトになる", async () => {
      seed();
      const { auth, signOut, getAccessToken } = await load();
      const SecureStore = await import("expo-secure-store");
      vi.spyOn(SecureStore, "deleteItemAsync").mockRejectedValue(new Error("Keystore"));

      await signOut();

      expect(auth.state).toEqual({ status: "signedOut" });
      await expect(getAccessToken()).rejects.toMatchObject({ name: "LoginRequiredError" });
      await vi.waitFor(() => expect(mocks.revokeAsync).toHaveBeenCalledOnce());
    });
  });

  describe("状態の購読", () => {
    it("最初の購読で保管したトークンを読み、変わるたびに知らせ、解除すると止まる", async () => {
      seed();
      const { auth, signOut } = await import("./auth.ts");
      const listener = vi.fn();

      const unsubscribe = auth.subscribe(listener);
      expect(auth.getSnapshot()).toEqual({ status: "loading" });
      await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
      expect(auth.getSnapshot().status).toBe("signedIn");

      unsubscribe();
      await signOut();
      expect(listener).toHaveBeenCalledOnce();
    });

    it("useAuth は今の状態を返す", async () => {
      const { auth, useAuth } = await load();
      expect(useAuth()).toBe(auth.state);
    });

    it("保管したものを読めなければ、ログアウトの状態で始める", async () => {
      store.set(KEY, "{壊れた");
      const { auth } = await load();
      expect(auth.state).toEqual({ status: "signedOut" });
    });
  });
});
