/**
 * Webhook service for Make.com integration
 */

import { getAppState, saveAppState } from './storage'

export interface WebhookPayload {
  tag: string
  deckData: string
  timestamp: string
}

/**
 * Send batch of scans to webhook
 */
export async function sendToWebhook(
  items: WebhookPayload[]
): Promise<void> {
  const state = getAppState()
  const webhookUrl = state.webhookUrl
  const apiKey = state.webhookApiKey

  if (!webhookUrl) {
    throw new Error('No webhook URL configured')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Add API key header if configured
  if (apiKey && apiKey.trim().length > 0) {
    headers['x-make-apikey'] = apiKey
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ scans: items }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Webhook request failed: ${response.status} ${errorText}`)
  }

  // Update last sync time
  saveAppState({
    lastSyncTime: Date.now(),
  })
}

/**
 * Get the configured webhook URL
 */
export function getWebhookUrl(): string | null {
  return getAppState().webhookUrl
}

/**
 * Set the webhook URL
 */
export function setWebhookUrl(url: string): void {
  saveAppState({ webhookUrl: url })
}

/**
 * Clear the webhook URL
 */
export function clearWebhookUrl(): void {
  saveAppState({ webhookUrl: null, webhookApiKey: null })
}

/**
 * Get the configured API key
 */
export function getWebhookApiKey(): string | null {
  return getAppState().webhookApiKey
}

/**
 * Set the webhook API key
 */
export function setWebhookApiKey(apiKey: string): void {
  saveAppState({ webhookApiKey: apiKey })
}

/**
 * Validate webhook URL format
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Make.com webhooks typically use HTTPS
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
