import { useState, useEffect } from 'react'
import { getAppState, saveAppState, AppState } from '../services/storage'

export function useAppState() {
  const [state, setState] = useState<AppState>(() => getAppState())

  const updateState = (updates: Partial<AppState>) => {
    setState((current) => {
      const updated = { ...current, ...updates }
      saveAppState(updates)
      return updated
    })
  }

  useEffect(() => {
    const handleStorageChange = () => {
      setState(getAppState())
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  return { state, updateState }
}
