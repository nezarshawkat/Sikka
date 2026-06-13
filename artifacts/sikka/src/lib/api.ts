const DEFAULT_API_ORIGIN = "https://sikka-mq6w.onrender.com";
const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;

type AuthTokenProvider = () => Promise<string | null>;
type QueuedPost = {
  id: string;
  path: string;
  body: unknown;
  createdAt: string;
};

let authTokenProvider: AuthTokenProvider | null = null;
const OFFLINE_QUEUE_KEY = "sikka-offline-post-queue";
const QUEUEABLE_POSTS = new Set(["/reports", "/reviews", "/transport-reports"]);

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  authTokenProvider = provider;
  void syncPendingOfflinePosts();
}

function readQueue(): QueuedPost[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed as QueuedPost[] : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedPost[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function shouldQueue(path: string, options: RequestInit): boolean {
  return (options.method || "GET").toUpperCase() === "POST" && QUEUEABLE_POSTS.has(path);
}

function enqueuePost(path: string, body: unknown) {
  const queue = readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path,
    body,
    createdAt: new Date().toISOString(),
  });
  writeQueue(queue.slice(-100));
}

export async function syncPendingOfflinePosts(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length) return;
  const remaining: QueuedPost[] = [];
  for (const item of queue) {
    try {
      await apiFetch(item.path, {
        method: "POST",
        body: JSON.stringify(item.body),
        headers: { "X-Sikka-Offline-Replay": "1" },
      });
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
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

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch (err) {
    if (shouldQueue(path, options)) {
      enqueuePost(path, options.body ? JSON.parse(String(options.body)) : null);
      return { queued: true } as T;
    }
    throw err;
  }

  if (!res.ok) {
    if (shouldQueue(path, options) && (res.status === 0 || res.status >= 500)) {
      enqueuePost(path, options.body ? JSON.parse(String(options.body)) : null);
      return { queued: true } as T;
    }
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

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncPendingOfflinePosts());
}
