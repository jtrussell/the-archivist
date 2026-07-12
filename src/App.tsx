import { useState, useEffect } from 'react'
import { SettingsView } from './components/SettingsView'
import { ScanView } from './components/ScanView'
import { SearchView } from './components/SearchView'
import { SignInView } from './components/SignInView'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { setupAutoSync, getUnsyncedCount } from './services/syncService'

type View = 'scan' | 'search' | 'settings'

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'scan', label: 'Scan' },
  { view: 'search', label: 'Search' },
  { view: 'settings', label: 'Settings' },
]

function AppContent() {
  const { session, loading } = useAuth()
  const [view, setView] = useState<View>('scan')
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
                {NAV_ITEMS.map(({ view: v, label }) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-4 py-2 transition-colors ${
                      view === v
                        ? 'border-b-2 border-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <main className="container mx-auto px-4 py-8">
            {view === 'scan' && <ScanView />}
            {view === 'search' && <SearchView />}
            {view === 'settings' && <SettingsView />}
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
