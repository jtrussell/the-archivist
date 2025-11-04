/**
 * Google Sheets API service
 */

import { getAccessToken } from './googleAuth'
import { saveAppState, getAppState } from './storage'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface SheetInfo {
  id: string
  name: string
  url: string
}

/**
 * List user's spreadsheets
 * Note: Sheets API doesn't have a direct "list all sheets" endpoint
 * Users will need to manually enter their sheet ID
 */
export async function getUserSheets(): Promise<SheetInfo[]> {
  // This would require Drive API scope, which we're avoiding for simplicity
  // Instead, we'll have users paste their sheet ID or URL
  throw new Error('Not implemented - users should provide sheet ID manually')
}

/**
 * Get spreadsheet info by ID
 */
export async function getSpreadsheetInfo(
  spreadsheetId: string
): Promise<SheetInfo> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=spreadsheetId,properties.title,spreadsheetUrl`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to get spreadsheet info: ${
        error.error?.message || 'Unknown error'
      }`
    )
  }

  const data = await response.json()

  return {
    id: data.spreadsheetId,
    name: data.properties.title,
    url: data.spreadsheetUrl,
  }
}

/**
 * Create a new spreadsheet with proper formatting
 */
export async function createSpreadsheet(
  title: string = 'KeyForge Deck Locations'
): Promise<SheetInfo> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(SHEETS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: title,
      },
      sheets: [
        {
          properties: {
            title: 'Deck Locations',
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to create spreadsheet: ${error.error?.message || 'Unknown error'}`
    )
  }

  const data = await response.json()
  const sheetId = data.spreadsheetId

  // Add header row
  await appendRow(sheetId, ['Timestamp', 'Deck Data', 'Tag'])

  // Format header row (bold)
  await fetch(`${SHEETS_API_BASE}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: {
                  bold: true,
                },
              },
            },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    }),
  })

  return {
    id: sheetId,
    name: title,
    url: data.spreadsheetUrl,
  }
}

/**
 * Append a row to the spreadsheet
 */
export async function appendRow(
  spreadsheetId: string,
  values: string[]
): Promise<void> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/A:Z:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [values],
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to append row: ${error.error?.message || 'Unknown error'}`
    )
  }

  // Update last sync time
  saveAppState({
    lastSyncTime: Date.now(),
  })
}

/**
 * Set the active spreadsheet ID
 */
export function setActiveSpreadsheet(spreadsheetId: string): void {
  saveAppState({ sheetId: spreadsheetId })
}

/**
 * Get the active spreadsheet ID
 */
export function getActiveSpreadsheetId(): string | null {
  return getAppState().sheetId
}

/**
 * Extract spreadsheet ID from various URL formats
 */
export function extractSpreadsheetId(input: string): string | null {
  // If it's already just an ID (no slashes)
  if (!input.includes('/') && input.length > 20) {
    return input
  }

  // Try to extract from URL
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/spreadsheets\/u\/\d+\/d\/([a-zA-Z0-9-_]+)/,
    /^([a-zA-Z0-9-_]+)$/,
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}
