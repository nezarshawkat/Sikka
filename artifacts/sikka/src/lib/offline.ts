/**
 * Offline Support Utilities
 * Handles data persistence and offline synchronization
 */

const OFFLINE_CACHE_KEY = 'sikka:offline:data';
const OFFLINE_QUEUE_KEY = 'sikka:offline:queue';
const LAST_SYNC_KEY = 'sikka:last:sync';

export interface OfflineData {
  trip?: any;
  userData?: any;
  settings?: any;
  timestamp: number;
}

/**
 * Save data for offline access
 */
export const saveOfflineData = (data: Partial<OfflineData>) => {
  try {
    const existing = getOfflineData();
    const updated = {
      ...existing,
      ...data,
      timestamp: Date.now(),
    };
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save offline data:', err);
  }
};

/**
 * Retrieve cached offline data
 */
export const getOfflineData = (): OfflineData => {
  try {
    const data = localStorage.getItem(OFFLINE_CACHE_KEY);
    return data ? JSON.parse(data) : { timestamp: 0 };
  } catch (err) {
    console.error('Failed to retrieve offline data:', err);
    return { timestamp: 0 };
  }
};

/**
 * Save trip data for offline access
 */
export const saveOfflineTrip = (trip: any) => {
  saveOfflineData({ trip });
};

/**
 * Get offline trip data
 */
export const getOfflineTrip = () => {
  return getOfflineData().trip;
};

/**
 * Queue an API request for retry when online
 */
export const queueOfflineRequest = (request: {
  method: string;
  url: string;
  body?: any;
  timestamp: number;
}) => {
  try {
    const queue = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const requests = queue ? JSON.parse(queue) : [];
    requests.push(request);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(requests));
  } catch (err) {
    console.error('Failed to queue offline request:', err);
  }
};

/**
 * Get pending offline requests
 */
export const getPendingRequests = () => {
  try {
    const queue = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
  } catch (err) {
    console.error('Failed to retrieve pending requests:', err);
    return [];
  }
};

/**
 * Clear pending requests after successful sync
 */
export const clearPendingRequests = () => {
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(Date.now()));
  } catch (err) {
    console.error('Failed to clear pending requests:', err);
  }
};

/**
 * Check if we have network connectivity
 */
export const isOnline = () => navigator.onLine;

/**
 * Setup offline/online event listeners
 */
export const setupOfflineListeners = (onOnline?: () => void, onOffline?: () => void) => {
  window.addEventListener('online', () => {
    console.log('App is back online');
    onOnline?.();
  });

  window.addEventListener('offline', () => {
    console.log('App is offline');
    onOffline?.();
  });
};

/**
 * Clean up offline cache for a specific trip
 */
export const clearOfflineTrip = () => {
  try {
    const existing = getOfflineData();
    const updated = { ...existing };
    delete updated.trip;
    updated.timestamp = Date.now();
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to clear offline trip:', err);
  }
};

/**
 * Get time since last sync
 */
export const getTimeSinceLastSync = (): number => {
  try {
    const lastSync = localStorage.getItem(LAST_SYNC_KEY);
    if (!lastSync) return Infinity;
    return Date.now() - parseInt(lastSync);
  } catch (err) {
    return Infinity;
  }
};
