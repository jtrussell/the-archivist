/**
 * Sync service for handling offline queue and batch submissions
 */

import { getUnsyncedQueueItems, markQueueItemSynced, addToScanQueue, clearSyncedQueueItems } from './storage'
import { sendToWebhook, WebhookPayload } from './webhookService'
import { transformDeckData } from './deckTransform'

export interface ScanResult {
  success: boolean
  queued: boolean
  error?: string
}

/**
 * Record a scan (queued for batch submission)
 */
export async function recordScan(
  rawQRData: string,
  tag: string
): Promise<ScanResult> {
  try {
    // Transform the deck data
    const deckData = await transformDeckData(rawQRData)

    // Create timestamp
    const timestamp = new Date().toISOString()

    // Always queue for batch submission
    addToScanQueue({
      timestamp,
      deckData,
      tag,
      synced: false,
    })

    return {
      success: true,
      queued: true,
    }
  } catch (error) {
    console.error('Failed to record scan:', error)
    return {
      success: false,
      queued: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Sync all unsynced items in the queue as a batch
 */
export async function syncQueue(): Promise<{
  synced: number
  failed: number
  errors: string[]
}> {
  const unsynced = getUnsyncedQueueItems()

  if (unsynced.length === 0) {
    return {
      synced: 0,
      failed: 0,
      errors: [],
    }
  }

  try {
    // Convert queue items to webhook payload
    const payload: WebhookPayload[] = unsynced.map(item => ({
      tag: item.tag,
      deckData: item.deckData,
      timestamp: item.timestamp,
    }))

    // Send batch to webhook
    await sendToWebhook(payload)

    // Mark all items as synced
    unsynced.forEach(item => markQueueItemSynced(item.id))

    // Housekeeping: clear synced items
    setTimeout(clearSyncedQueueItems, 1000)

    return {
      synced: unsynced.length,
      failed: 0,
      errors: [],
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return {
      synced: 0,
      failed: unsynced.length,
      errors: [errorMsg],
    }
  }
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
