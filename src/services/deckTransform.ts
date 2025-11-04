/**
 * Deck data transformation service
 *
 * This module contains the logic for transforming QR code data
 * before it's written to the Google Sheet.
 */

/**
 * Transform QR code data before storing
 *
 * PLACEHOLDER IMPLEMENTATION
 *
 * Currently just returns the raw QR code data as a string.
 * Replace this function with your own transformation logic.
 *
 * Example transformations you might want to add:
 * - Extract deck ID from KeyForge URL
 * - Fetch deck name from DoK API
 * - Parse additional metadata from QR code
 * - Validate deck ID format
 *
 * @param qrData - Raw data from QR code scan
 * @returns Transformed data to store in sheet
 */
export async function transformDeckData(qrData: string): Promise<string> {
  // Placeholder: just return the raw data
  // You can replace this with your own transformation logic

  // Example: If you want to extract deck ID from KeyForge URL
  // const match = qrData.match(/deck-details\/([^/?]+)/)
  // if (match) return match[1]

  // For now, just return as-is
  return qrData
}

/**
 * Extract deck ID from KeyForge QR code URL
 *
 * KeyForge QR codes typically encode:
 * https://www.keyforgegame.com/deck-details/{deck-id}
 *
 * @param qrData - Raw QR code data
 * @returns Deck ID or null if not found
 */
export function extractDeckId(qrData: string): string | null {
  try {
    // Try to match KeyForge deck URL pattern
    const match = qrData.match(/deck-details\/([^/?]+)/)
    if (match && match[1]) {
      return match[1]
    }

    // If no match, check if it's already just a deck ID
    // (in case QR format changes or for testing)
    if (qrData.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
      return qrData
    }

    return null
  } catch (error) {
    console.error('Error extracting deck ID:', error)
    return null
  }
}
