import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PermissionCode, SessionUser } from "@bcis/shared";
import { ApiClient, DEFAULT_API_BASE_URL } from "./api";

type AuthState = {
  user: SessionUser | null;
  token: string | null;
  locked: boolean;
  ready: boolean;
  apiBaseUrl: string;
  api: ApiClient;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<void>;
  can: (permission: PermissionCode | string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);
const TOKEN_KEY = "bcis.token";
const USER_KEY = "bcis.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [locked, setLocked] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);

  const api = useMemo(
    () => new ApiClient(() => apiBaseUrl, () => token),
    [apiBaseUrl, token],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolvedBaseUrl = DEFAULT_API_BASE_URL;
      try {
        if (window.bcis?.getConfig) {
          const cfg = await window.bcis.getConfig();
          resolvedBaseUrl = cfg.apiBaseUrl;
          if (!cancelled) setApiBaseUrl(resolvedBaseUrl);
        }
      } catch {
        // browser fallback during vite-only preview
      }

      const savedToken = sessionStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        try {
          const sessionApi = new ApiClient(
            () => resolvedBaseUrl,
            () => savedToken,
          );
          const profile = await sessionApi.me();
          if (!cancelled) {
            sessionStorage.setItem(USER_KEY, JSON.stringify(profile.user));
            setToken(savedToken);
            setUser(profile.user);
            if (profile.sessionTimeoutMinutes) {
              setSessionTimeoutMinutes(profile.sessionTimeoutMinutes);
            }
          }
        } catch {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(USER_KEY);
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((nextToken: string, nextUser: SessionUser) => {
    sessionStorage.setItem(TOKEN_KEY, nextToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
    setLocked(false);
  }, []);

  const clear = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setLocked(false);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.login(username, password);
      persist(result.token, result.user);
      if (result.sessionTimeoutMinutes) {
        setSessionTimeoutMinutes(result.sessionTimeoutMinutes);
      }
    },
    [api, persist],
  );

  const logout = useCallback(async () => {
    const serverLogout = token ? api.logout() : Promise.resolve();
    clear();
    try {
      await serverLogout;
    } catch {
      // local session is already cleared
    }
    try {
      await window.bcis?.logout?.();
    } catch {
      // ignore
    }
  }, [api, clear, token]);

  const lock = useCallback(() => {
    setLocked(true);
    void window.bcis?.lockSession?.();
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!user) return;
      const result = await api.login(user.username, password);
      persist(result.token, result.user);
      if (result.sessionTimeoutMinutes) {
        setSessionTimeoutMinutes(result.sessionTimeoutMinutes);
      }
    },
    [api, persist, user],
  );

  const can = useCallback(
    (permission: PermissionCode | string) =>
      Boolean(user?.permissions.includes(permission)),
    [user],
  );

  useEffect(() => {
    if (!user || locked) return;
    const ms = Math.max(1, sessionTimeoutMinutes) * 60_000;
    let timer = window.setTimeout(() => setLocked(true), ms);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setLocked(true);
        void window.bcis?.lockSession?.();
      }, ms);
    };
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, bump);
    };
  }, [user, locked, sessionTimeoutMinutes]);

  const value: AuthState = {
    user,
    token,
    locked,
    ready,
    apiBaseUrl,
    api,
    login,
    logout,
    lock,
    unlock,
    can,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
