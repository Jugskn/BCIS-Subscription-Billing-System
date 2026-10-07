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
import { ApiClient } from "./api";

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
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:3001");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [locked, setLocked] = useState(false);

  const api = useMemo(
    () => new ApiClient(() => apiBaseUrl, () => token),
    [apiBaseUrl, token],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.bcis?.getConfig) {
          const cfg = await window.bcis.getConfig();
          if (!cancelled) setApiBaseUrl(cfg.apiBaseUrl);
        }
      } catch {
        // browser fallback during vite-only preview
      }

      const savedToken = sessionStorage.getItem(TOKEN_KEY);
      const savedUser = sessionStorage.getItem(USER_KEY);
      if (savedToken && savedUser) {
        setToken(savedToken);
        try {
          setUser(JSON.parse(savedUser) as SessionUser);
        } catch {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(USER_KEY);
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
    },
    [api, persist],
  );

  const logout = useCallback(async () => {
    try {
      if (token) await api.logout();
    } catch {
      // still clear local session
    }
    try {
      await window.bcis?.logout?.();
    } catch {
      // ignore
    }
    clear();
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
    },
    [api, persist, user],
  );

  const can = useCallback(
    (permission: PermissionCode | string) =>
      Boolean(user?.permissions.includes(permission)),
    [user],
  );

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
