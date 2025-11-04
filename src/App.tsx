import { useState, useEffect } from 'react'
import { SettingsView } from './components/SettingsView'
import { ScanView } from './components/ScanView'
import { isWebhookConfigured } from './services/storage'
import { setupAutoSync, getUnsyncedCount } from './services/syncService'

function App() {
  const [view, setView] = useState<'settings' | 'scan'>('settings')
  const [configured, setConfigured] = useState(false)
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  useEffect(() => {
    checkConfig()

    // Setup auto-sync for offline queue
    setupAutoSync()

    // Update unsynced count periodically
    const interval = setInterval(() => {
      setUnsyncedCount(getUnsyncedCount())
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const checkConfig = () => {
    setConfigured(isWebhookConfigured())
    setUnsyncedCount(getUnsyncedCount())
  }

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

      <nav className="border-b">
        <div className="container mx-auto px-4">
          <div className="flex gap-4">
            <button
              onClick={() => setView('settings')}
              className={`px-4 py-2 transition-colors ${
                view === 'settings'
                  ? 'border-b-2 border-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Settings
            </button>
            <button
              onClick={() => setView('scan')}
              className={`px-4 py-2 transition-colors ${
                view === 'scan'
                  ? 'border-b-2 border-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Scan
            </button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        {view === 'settings' && (
          <SettingsView
            isConfigured={configured}
            onConfigChange={checkConfig}
          />
        )}
        {view === 'scan' && <ScanView isConfigured={configured} />}
      </main>
    </div>
  )
}

export default App
