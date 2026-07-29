import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SettingsView } from './components/SettingsView'
import { ScanView } from './components/ScanView'
import { SearchView } from './components/SearchView'
import { DeckDetailView } from './components/DeckDetailView'
import { SignInView } from './components/SignInView'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { setupAutoSync, getUnsyncedCount } from './services/syncService'

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/scan', label: 'Scan' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' },
]

function AppContent() {
  const { session, loading } = useAuth()
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  useEffect(() => {
    if (!session) return

    setUnsyncedCount(getUnsyncedCount())

    // Setup auto-sync for offline queue
    setupAutoSync()

    // Update unsynced count periodically
    const interval = setInterval(() => {
      setUnsyncedCount(getUnsyncedCount())
    }, 5000)

    return () => clearInterval(interval)
  }, [session])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">The Archivist</h1>
          {unsyncedCount > 0 && (
            <div className="text-sm bg-yellow-900 text-yellow-200 px-3 py-1 rounded-full">
              {unsyncedCount} unsynced
            </div>
          )}
        </div>
      </header>

      {loading ? (
        <main className="container mx-auto px-4 py-8">
          <p className="text-center text-muted-foreground">Loading...</p>
        </main>
      ) : !session ? (
        <main className="container mx-auto px-4 py-8">
          <SignInView />
        </main>
      ) : (
        <>
          <nav className="border-b">
            <div className="container mx-auto px-4">
              <div className="flex gap-4">
                {NAV_ITEMS.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `px-4 py-2 transition-colors ${
                        isActive
                          ? 'border-b-2 border-primary font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          </nav>

          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route index element={<Navigate to="/scan" replace />} />
              <Route path="/scan" element={<ScanView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/deck/:scanId" element={<DeckDetailView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="*" element={<Navigate to="/scan" replace />} />
            </Routes>
          </main>
        </>
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
