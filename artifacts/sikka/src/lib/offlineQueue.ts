// Offline submission queue.
//
// Rider feedback — reports, segment reviews, bus confirmations and discovery
// traces — is queued locally in IndexedDB whenever the device is offline (or a
// submission fails for network reasons) and flushed automatically once the app
// is back online. Callers use `submitOrQueue` instead of calling the API
// directly so the happy path stays online-first but never loses data offline.

import { api } from "./api";

export type QueueKind = "report" | "review" | "bus_confirmation" | "discovery_trace";

type QueuedItem = {
  id: string;
  kind: QueueKind;
  path: string;
  body: unknown;
  createdAt: number;
  attempts: number;
};

const QUEUE_DB = "sikka-offline";
const QUEUE_STORE = "outbox";
const QUEUE_DB_VERSION = 2;

let flushing = false;
let initialized = false;

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB, QUEUE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Shared DB with the route snapshot store; create both if missing.
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function putItem(item: QueuedItem): Promise<void> {
  const db = await openQueueDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

async function deleteItem(id: string): Promise<void> {
  const db = await openQueueDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

async function readAll(): Promise<QueuedItem[]> {
  const db = await openQueueDb();
  return new Promise((resolve) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueuedItem[]) ?? []);
    req.onerror = () => resolve([]);
    tx.oncomplete = () => db.close();
  });
}

export async function getQueuedCount(): Promise<number> {
  if (!("indexedDB" in window)) return 0;
  return (await readAll().catch(() => [])).length;
}

async function enqueue(kind: QueueKind, path: string, body: unknown): Promise<void> {
  if (!("indexedDB" in window)) throw new Error("offline-storage-unavailable");
  await putItem({ id: newId(), kind, path, body, createdAt: Date.now(), attempts: 0 });
}

// A network error (offline / DNS / fetch throw) — as opposed to a 4xx/5xx the
// server actually returned, which we should not blindly retry forever.
function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  return err instanceof TypeError; // fetch throws TypeError on network failure
}

// Try the request online; if the device is offline or the request fails for
// network reasons, persist it for later sync and resolve as "queued".
export async function submitOrQueue(
  kind: QueueKind,
  path: string,
  body: unknown,
): Promise<{ queued: boolean }> {
  if (!navigator.onLine) {
    await enqueue(kind, path, body);
    return { queued: true };
  }
  try {
    await api.post(path, body);
    // Opportunistically flush anything that piled up while offline.
    void flushQueue();
    return { queued: false };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue(kind, path, body);
      return { queued: true };
    }
    throw err;
  }
}

// Flush all queued submissions in FIFO order. Items that still fail for network
// reasons are kept; items the server rejects after several attempts are dropped
// so a permanently-bad payload cannot wedge the queue.
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  if (flushing || !navigator.onLine || !("indexedDB" in window)) {
    return { sent: 0, remaining: await getQueuedCount() };
  }
  flushing = true;
  let sent = 0;
  try {
    const items = (await readAll()).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of items) {
      try {
        await api.post(item.path, item.body);
        await deleteItem(item.id);
        sent++;
      } catch (err) {
        if (isNetworkError(err)) break; // stop; retry on next online event
        if (item.attempts >= 4) {
          await deleteItem(item.id); // poison payload — drop it
        } else {
          await putItem({ ...item, attempts: item.attempts + 1 });
        }
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, remaining: await getQueuedCount() };
}

// Wire automatic syncing: flush on startup and whenever connectivity returns.
export function initOfflineSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const onOnline = () => { void flushQueue(); };
  window.addEventListener("online", onOnline);
  if (navigator.onLine) void flushQueue();
}
