/**
 * Sync service for handling the offline queue and Supabase submission
 */

import {
  getUnsyncedQueueItems,
  markQueueItemSynced,
  addToScanQueue,
  clearSyncedQueueItems,
  updateQueueItem,
} from './storage'
import { recordScanToDb } from './scanService'
import { parseAndFetchDeck, fetchDeckName } from './deckTransform'
import { supabase } from '../lib/supabase'

export interface ScanResult {
  success: boolean
  queued: boolean
  /** Position assigned by the database, when the scan synced immediately */
  position?: number
  /** Deck name from the Master Vault lookup (or already known for this copy); null when unknown */
  deckName?: string | null
  /** True when the scanned code is a Ghost Galaxy deck clone */
  isClone?: boolean
  error?: string
}

export interface SyncSummary {
  synced: number
  failed: number
  errors: string[]
  /** Position assigned to the last successfully synced scan */
  lastPosition?: number
  /** Name the database recorded for the last successfully synced scan */
  lastDeckName?: string | null
}

/**
 * Record a scan: parse the QR data, queue it, and sync immediately when online
 */
export async function recordScan(
  rawQRData: string,
  label: string
): Promise<ScanResult> {
  try {
    const deck = await parseAndFetchDeck(rawQRData)
    const scannedAt = new Date().toISOString()

    addToScanQueue({
      scannedAt,
      label,
      deckId: deck.deckId,
      deckCode: deck.deckCode,
      deckUuid: deck.deckUuid,
      deckName: deck.deckName,
      isClone: deck.isClone,
      synced: false,
    })

    if (navigator.onLine) {
      const result = await syncQueue()
      if (result.failed === 0 && result.lastPosition !== undefined) {
        return {
          success: true,
          queued: false,
          position: result.lastPosition,
          // The database may know a name the API couldn't give us (a linked
          // clone, or a name the user entered earlier for this copy)
          deckName: result.lastDeckName ?? deck.deckName,
          isClone: deck.isClone,
        }
      }
    }

    return { success: true, queued: true, deckName: deck.deckName, isClone: deck.isClone }
  } catch (error) {
    console.error('Failed to record scan:', error)
    return {
      success: false,
      queued: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

let syncInFlight: Promise<SyncSummary> | null = null

/**
 * Sync unsynced queue items sequentially, in scan order.
 * Stops on the first failure so order (and therefore positions) is preserved
 * on retry. Items stay queued if there is no active session.
 * Concurrent callers share a single flush to avoid double-inserting items.
 */
export async function syncQueue(): Promise<SyncSummary> {
  if (syncInFlight) return syncInFlight

  syncInFlight = doSyncQueue().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

async function doSyncQueue(): Promise<SyncSummary> {
  const unsynced = getUnsyncedQueueItems()

  if (unsynced.length === 0) {
    return { synced: 0, failed: 0, errors: [] }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return {
      synced: 0,
      failed: unsynced.length,
      errors: ['Sign in required to sync scans'],
    }
  }

  let syncedCount = 0
  let lastPosition: number | undefined
  let lastDeckName: string | null | undefined

  for (const item of unsynced) {
    try {
      // Backfill the deck name if the fetch failed at scan time (e.g. offline).
      // Clone codes are skipped inside fetchDeckName (the API can't resolve them).
      let deckName = item.deckName
      if (deckName === null) {
        deckName = await fetchDeckName(item)
        if (deckName !== null) {
          updateQueueItem(item.id, { deckName })
        }
      }

      const recorded = await recordScanToDb({
        label: item.label,
        deckId: item.deckId,
        deckName,
        deckCode: item.deckCode,
        deckUuid: item.deckUuid,
        scannedAt: item.scannedAt,
        isClone: item.isClone ?? false,
      })

      markQueueItemSynced(item.id)
      syncedCount++
      lastPosition = recorded.position
      lastDeckName = recorded.deckName
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      return {
        synced: syncedCount,
        failed: unsynced.length - syncedCount,
        errors: [errorMsg],
        lastPosition,
        lastDeckName,
      }
    }
  }

  // Housekeeping: clear synced items
  setTimeout(clearSyncedQueueItems, 1000)

  return { synced: syncedCount, failed: 0, errors: [], lastPosition, lastDeckName }
}

/**
 * Get count of unsynced items
 */
export function getUnsyncedCount(): number {
  return getUnsyncedQueueItems().length
}

/**
 * Auto-sync when coming online
 */
export function setupAutoSync(): void {
  // Sync when online status changes
  window.addEventListener('online', async () => {
    console.log('Connection restored, syncing queue...')
    try {
      const result = await syncQueue()
      console.log('Auto-sync completed:', result)
    } catch (error) {
      console.error('Auto-sync failed:', error)
    }
  })

  // Try to sync immediately if online
  if (navigator.onLine && getUnsyncedCount() > 0) {
    setTimeout(async () => {
      try {
        await syncQueue()
      } catch (error) {
        console.error('Initial sync failed:', error)
      }
    }, 1000)
  }
}
