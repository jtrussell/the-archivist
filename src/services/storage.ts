/**
 * localStorage persistence layer for app state
 */

export interface AppState {
  currentTag: string
  webhookUrl: string | null
  webhookApiKey: string | null
  lastSyncTime: number | null
}

export interface ScanQueueItem {
  id: string
  timestamp: string
  deckData: string
  tag: string
  synced: boolean
}

const STORAGE_KEYS = {
  APP_STATE: 'archivist_app_state',
  SCAN_QUEUE: 'archivist_scan_queue',
} as const

const DEFAULT_APP_STATE: AppState = {
  currentTag: '',
  webhookUrl: null,
  webhookApiKey: null,
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
 * Mark queue item as synced
 */
export function markQueueItemSynced(id: string): void {
  try {
    const queue = getScanQueue()
    const updated = queue.map(item =>
      item.id === id ? { ...item, synced: true } : item
    )
    localStorage.setItem(STORAGE_KEYS.SCAN_QUEUE, JSON.stringify(updated))
  } catch (error) {
    console.error('Error marking queue item as synced:', error)
  }
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
 * Check if webhook is configured
 */
export function isWebhookConfigured(): boolean {
  const state = getAppState()
  return !!state.webhookUrl && state.webhookUrl.trim().length > 0
}
