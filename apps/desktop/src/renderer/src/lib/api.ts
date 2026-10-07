import type { LoginResponse, SessionUser, UserListItem } from "@bcis/shared";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export class ApiClient {
  constructor(
    private readonly getBaseUrl: () => string,
    private readonly getToken: () => string | null,
  ) {}

  private async request<T>(
    path: string,
    init?: RequestInit & { json?: unknown },
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (init?.json !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${this.getBaseUrl()}${path}`, {
      ...init,
      headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });

    if (!res.ok) {
      let code = "REQUEST_FAILED";
      let message = "Request failed.";
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        // ignore parse errors
      }
      throw new ApiClientError(res.status, code, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health() {
    return this.request<{ status: string }>("/health");
  }

  login(username: string, password: string) {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      json: { username, password },
    });
  }

  logout() {
    return this.request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  }

  me() {
    return this.request<{ user: SessionUser }>("/auth/me");
  }

  listUsers(params: { page?: number; pageSize?: number; search?: string }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return this.request<Paginated<UserListItem>>(
      `/users${qs ? `?${qs}` : ""}`,
    );
  }

  createUser(input: {
    username: string;
    password: string;
    fullName: string;
    roleNames: string[];
  }) {
    return this.request<UserListItem>("/users", {
      method: "POST",
      json: input,
    });
  }

  deactivateUser(id: string) {
    return this.request<{ ok: boolean }>(`/users/${id}/deactivate`, {
      method: "POST",
    });
  }

  assignRoles(id: string, roleNames: string[]) {
    return this.request<{ ok: boolean }>(`/users/${id}/roles`, {
      method: "PUT",
      json: { roleNames },
    });
  }
}
