/**
 * localStorage persistence layer for app state
 */

export interface AppState {
  currentLabel: string
  lastSyncTime: number | null
}

export interface ScanQueueItem {
  id: string
  scannedAt: string
  label: string
  deckId: string
  deckCode: string | null
  deckUuid: string | null
  deckName: string | null
  synced: boolean
}

// v2: keys bumped for the Supabase migration so stale Make.com-era data is ignored
const STORAGE_KEYS = {
  APP_STATE: 'archivist_app_state_v2',
  SCAN_QUEUE: 'archivist_scan_queue_v2',
} as const

const DEFAULT_APP_STATE: AppState = {
  currentLabel: '',
  lastSyncTime: null,
}

/**
 * Get app state from localStorage
 */
export function getAppState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.APP_STATE)
    if (!stored) return { ...DEFAULT_APP_STATE }

    return { ...DEFAULT_APP_STATE, ...JSON.parse(stored) }
  } catch (error) {
    console.error('Error reading app state from localStorage:', error)
    return { ...DEFAULT_APP_STATE }
  }
}

/**
 * Save app state to localStorage
 */
export function saveAppState(state: Partial<AppState>): void {
  try {
    const current = getAppState()
    const updated = { ...current, ...state }
    localStorage.setItem(STORAGE_KEYS.APP_STATE, JSON.stringify(updated))
  } catch (error) {
    console.error('Error saving app state to localStorage:', error)
  }
}

/**
 * Clear all app state (logout)
 */
export function clearAppState(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.APP_STATE)
    localStorage.removeItem(STORAGE_KEYS.SCAN_QUEUE)
  } catch (error) {
    console.error('Error clearing app state:', error)
  }
}

/**
 * Get scan queue from localStorage
 */
export function getScanQueue(): ScanQueueItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SCAN_QUEUE)
    if (!stored) return []

    return JSON.parse(stored)
  } catch (error) {
    console.error('Error reading scan queue from localStorage:', error)
    return []
  }
}

/**
 * Add item to scan queue
 */
export function addToScanQueue(item: Omit<ScanQueueItem, 'id'>): string {
  try {
    const queue = getScanQueue()
    const id = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newItem = { ...item, id }
    queue.push(newItem)
    localStorage.setItem(STORAGE_KEYS.SCAN_QUEUE, JSON.stringify(queue))
    return id
  } catch (error) {
    console.error('Error adding to scan queue:', error)
    throw error
  }
}

/**
 * Update fields on a queue item (e.g. backfilled deck name)
 */
export function updateQueueItem(id: string, updates: Partial<ScanQueueItem>): void {
  try {
    const queue = getScanQueue()
    const updated = queue.map(item =>
      item.id === id ? { ...item, ...updates } : item
    )
    localStorage.setItem(STORAGE_KEYS.SCAN_QUEUE, JSON.stringify(updated))
  } catch (error) {
    console.error('Error updating queue item:', error)
  }
}

/**
 * Mark queue item as synced
 */
export function markQueueItemSynced(id: string): void {
  updateQueueItem(id, { synced: true })
}

/**
 * Get unsynced items from queue
 */
export function getUnsyncedQueueItems(): ScanQueueItem[] {
  return getScanQueue().filter(item => !item.synced)
}

/**
 * Clear synced items from queue (housekeeping)
 */
export function clearSyncedQueueItems(): void {
  try {
    const queue = getScanQueue()
    const unsynced = queue.filter(item => !item.synced)
    localStorage.setItem(STORAGE_KEYS.SCAN_QUEUE, JSON.stringify(unsynced))
  } catch (error) {
    console.error('Error clearing synced queue items:', error)
  }
}

/**
 * Clear entire scan queue
 */
export function clearScanQueue(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.SCAN_QUEUE)
  } catch (error) {
    console.error('Error clearing scan queue:', error)
  }
}
