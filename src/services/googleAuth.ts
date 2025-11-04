/**
 * Google OAuth 2.0 service with PKCE flow
 */

import { saveAppState, getAppState, clearAppState } from './storage'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets'

/**
 * Generate random string for PKCE
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate SHA256 hash
 */
async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return await crypto.subtle.digest('SHA-256', data)
}

/**
 * Base64-URL encode
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(byte => {
    str += String.fromCharCode(byte)
  })
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Generate PKCE code verifier and challenge
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(64)
  const hashed = await sha256(verifier)
  const challenge = base64UrlEncode(hashed)

  return { verifier, challenge }
}

/**
 * Start OAuth flow - redirects user to Google
 */
export async function startOAuthFlow(): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI

  if (!clientId || !redirectUri) {
    throw new Error('Missing OAuth configuration. Please set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_REDIRECT_URI')
  }

  // Generate PKCE parameters
  const { verifier, challenge } = await generatePKCE()

  // Store verifier in sessionStorage (will be needed after redirect)
  sessionStorage.setItem('pkce_verifier', verifier)

  // Generate state for CSRF protection
  const state = generateRandomString(32)
  sessionStorage.setItem('oauth_state', state)

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // Request refresh token
    prompt: 'consent', // Force consent screen to ensure refresh token
  })

  const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`

  // Redirect to Google
  window.location.href = authUrl
}

/**
 * Handle OAuth redirect - exchange code for tokens
 */
export async function handleOAuthRedirect(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  // Check if this is an OAuth redirect
  if (!code || !state) {
    return false
  }

  // Verify state (CSRF protection)
  const storedState = sessionStorage.getItem('oauth_state')
  if (state !== storedState) {
    throw new Error('Invalid OAuth state - possible CSRF attack')
  }

  // Get PKCE verifier
  const verifier = sessionStorage.getItem('pkce_verifier')
  if (!verifier) {
    throw new Error('Missing PKCE verifier')
  }

  // Exchange code for tokens
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
  const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI

  // Note: Google's Web application OAuth clients require client_secret even with PKCE
  // The security comes from PKCE + redirect URI whitelist, not the secret itself
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenParams.toString(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Token exchange failed: ${error.error_description || error.error}`)
  }

  const tokens = await response.json()

  // Save tokens
  const expiresIn = tokens.expires_in || 3600 // Default to 1 hour
  saveAppState({
    googleAccessToken: tokens.access_token,
    googleRefreshToken: tokens.refresh_token,
    tokenExpiry: Date.now() + (expiresIn * 1000),
  })

  // Clean up session storage
  sessionStorage.removeItem('pkce_verifier')
  sessionStorage.removeItem('oauth_state')

  // Clean up URL
  window.history.replaceState({}, document.title, window.location.pathname)

  return true
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(): Promise<void> {
  const state = getAppState()
  const refreshToken = state.googleRefreshToken

  if (!refreshToken) {
    throw new Error('No refresh token available')
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Token refresh failed: ${error.error_description || error.error}`)
  }

  const tokens = await response.json()

  // Save new access token
  const expiresIn = tokens.expires_in || 3600
  saveAppState({
    googleAccessToken: tokens.access_token,
    tokenExpiry: Date.now() + (expiresIn * 1000),
  })
}

/**
 * Logout - clear all stored auth data
 */
export function logout(): void {
  clearAppState()
}

/**
 * Get current access token (refreshes if needed)
 */
export async function getAccessToken(): Promise<string | null> {
  const state = getAppState()

  // Check if token exists and is valid
  if (state.googleAccessToken && state.tokenExpiry && state.tokenExpiry > Date.now()) {
    return state.googleAccessToken
  }

  // Try to refresh token
  if (state.googleRefreshToken) {
    try {
      await refreshAccessToken()
      const newState = getAppState()
      return newState.googleAccessToken
    } catch (error) {
      console.error('Failed to refresh token:', error)
      // If refresh fails, user needs to re-authenticate
      clearAppState()
      return null
    }
  }

  return null
}
