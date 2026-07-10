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
const staticGetCache = new Map<string, Promise<unknown>>();
const ADMIN_CACHE_DB = 'sikka-admin-static-cache';
const ADMIN_CACHE_STORE = 'responses';
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

function openAdminCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(ADMIN_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ADMIN_CACHE_STORE)) {
        request.result.createObjectStore(ADMIN_CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readPersistentStatic<T>(path: string): Promise<{ found: boolean; value?: T }> {
  const db = await openAdminCache();
  if (!db) return { found: false };
  return new Promise((resolve) => {
    const transaction = db.transaction(ADMIN_CACHE_STORE, 'readonly');
    const request = transaction.objectStore(ADMIN_CACHE_STORE).get(path);
    request.onsuccess = () => {
      const row = request.result as { value?: T } | undefined;
      resolve(row ? { found: true, value: row.value } : { found: false });
    };
    request.onerror = () => resolve({ found: false });
    transaction.oncomplete = () => db.close();
  });
}

async function writePersistentStatic(path: string, value: unknown): Promise<void> {
  const db = await openAdminCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ADMIN_CACHE_STORE, 'readwrite');
    transaction.objectStore(ADMIN_CACHE_STORE).put({ value, savedAt: Date.now() }, path);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); resolve(); };
  });
}

function staticGet<T>(path: string): Promise<T> {
  const existing = staticGetCache.get(path);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const persisted = await readPersistentStatic<T>(path);
    if (persisted.found) return persisted.value as T;
    const value = await apiFetch<T>(path);
    await writePersistentStatic(path, value);
    return value;
  })().catch((error) => {
      staticGetCache.delete(path);
      throw error;
    });
  staticGetCache.set(path, request);
  return request;
}

async function invalidatePersistentStatic(root?: string): Promise<void> {
  const db = await openAdminCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ADMIN_CACHE_STORE, 'readwrite');
    const store = transaction.objectStore(ADMIN_CACHE_STORE);
    if (!root) store.clear();
    else {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const key = String(row.key);
        if (key === root || key.startsWith(`${root}/`) || key.startsWith(`${root}?`) || key === '/analytics') row.delete();
        row.continue();
      };
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); resolve(); };
  });
}

async function invalidateStaticReads(path?: string): Promise<void> {
  if (!path) {
    staticGetCache.clear();
    await invalidatePersistentStatic();
    return;
  }
  const root = `/${path.split('/').filter(Boolean)[0] || ''}`;
  for (const key of staticGetCache.keys()) {
    if (key === root || key.startsWith(`${root}/`) || key.startsWith(`${root}?`)) staticGetCache.delete(key);
  }
  // These dashboards aggregate several collections and must refresh after an
  // actual edit, but never merely because the admin changed tabs.
  staticGetCache.delete('/analytics');
  await invalidatePersistentStatic(root);
}

async function mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const result = await apiFetch<T>(path, {
    method,
    ...(method !== 'DELETE' ? { body: JSON.stringify(body) } : {}),
  });
  await invalidateStaticReads(path);
  return result;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  getStatic: <T = unknown>(path: string) => staticGet<T>(path),
  invalidateStatic: invalidateStaticReads,
  post: <T = unknown>(path: string, body: unknown) => mutate<T>(path, 'POST', body),
  put: <T = unknown>(path: string, body: unknown) => mutate<T>(path, 'PUT', body),
  delete: <T = unknown>(path: string) => mutate<T>(path, 'DELETE'),
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncPendingOfflinePosts());
  window.addEventListener("focus", () => void syncPendingOfflinePosts());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncPendingOfflinePosts();
  });
}
