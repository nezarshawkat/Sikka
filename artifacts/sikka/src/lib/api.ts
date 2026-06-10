const DEFAULT_API_ORIGIN = "https://sikka-mq6w.onrender.com";
const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;

type AuthTokenProvider = () => Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  authTokenProvider = provider;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const adminToken = localStorage.getItem("sikka_admin_token");
  if (adminToken) {
    headers["X-Admin-Token"] = adminToken;
  } else if (authTokenProvider) {
    try {
      const token = await authTokenProvider();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Public requests can still continue without a Clerk token.
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T = unknown>(path: string) =>
    apiFetch<T>(path, { method: "DELETE" }),
};
