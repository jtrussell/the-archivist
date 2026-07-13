# The Archivist

A minimal-footprint web application for tracking KeyForge deck locations by scanning QR codes.

## Features

- **QR Code Scanning**: Use your device camera to scan KeyForge deck QR codes
- **Location Labels**: File decks under custom location labels (e.g., "Storage Box #3457"), picking from labels you've used before or creating new ones
- **Position Counter**: Each deck gets an incrementing position within its label, so you know exactly where in the box it sits
- **Deck Names**: Deck names are looked up automatically from the KeyForge Master Vault API at scan time
- **Search**: Find any deck's current location and position by name
- **Google Sign-In**: Your scans and labels are private to your account (Supabase Auth)
- **Offline Support**: Scans are queued when offline and synced when online
- **PWA**: Install as a mobile app for quick access
- **Zero Infrastructure**: Static frontend on GitHub Pages + a free Supabase project

## Quick Start

1. Visit the deployed app: `https://jtrussell.me/the-archivist/`
2. Sign in with Google
3. Pick or create a location label
4. Start scanning — each deck is stored with the next position in that label
5. Use the Search tab to find decks later

## Setup (self-hosting)

You need a free Supabase project and a Google OAuth client.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Open the SQL Editor and run the contents of [`supabase/schema.sql`](./supabase/schema.sql)
3. Under **Auth → URL Configuration**:
   - Site URL: `https://<your-username>.github.io/the-archivist/`
   - Redirect URLs: `https://<your-username>.github.io/the-archivist/**` and `http://localhost:5173/**`
4. Copy the Project URL and **publishable key** (`sb_publishable_...`, under **Settings → API Keys**) into `.env`:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
   ```
   These values are public by design; Row Level Security protects the data.
   (Don't use the legacy anon key — it's deprecated — and never use the
   secret or service-role key in this app.)

### 2. Google OAuth (for Supabase Auth)

1. In [Google Cloud Console](https://console.cloud.google.com), configure the OAuth consent screen (External; add yourself as a test user)
2. Create an OAuth client ID (type: Web application) with the authorized redirect URI shown in Supabase's **Auth → Providers → Google** panel (`https://<project-ref>.supabase.co/auth/v1/callback`)
3. Paste the Client ID and Secret into Supabase's Google provider settings and enable it

### 3. GitHub Pages

Push to `main` — the included workflow builds and deploys automatically. No repository secrets required.

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui-style components
- **QR Scanning**: @zxing/browser
- **Backend**: Supabase (Postgres + Auth), free tier
- **Deck Names**: KeyForge Master Vault API
- **Hosting**: GitHub Pages
- **PWA**: Service Worker + Web Manifest

## Data Model

- `labels` — one row per location label, per user
- `scans` — append-only history: every scan stores the deck ID (code or Master Vault UUID), deck name, label, an atomically assigned per-label position, and the time of scan
- `current_deck_locations` — view returning each deck's most recent scan (its current location), used by Search
- Positions are assigned inside the `record_scan` database function, so rapid scanning and multiple devices can't collide
- Row Level Security keeps every user's data private to their account

## Project Structure

```
the-archivist/
├── src/
│   ├── components/          # React components
│   │   ├── ui/              # shadcn-style base components (incl. combobox)
│   │   ├── QRScanner.tsx    # QR code scanner
│   │   ├── ScanView.tsx     # Main scanning interface
│   │   ├── SearchView.tsx   # Deck search
│   │   ├── SignInView.tsx   # Auth gate
│   │   └── SettingsView.tsx
│   ├── hooks/
│   │   ├── useAuth.tsx      # Supabase auth context
│   │   └── useAppState.ts   # localStorage-backed app state
│   ├── services/
│   │   ├── scanService.ts   # Supabase reads/writes (RPC, labels, search)
│   │   ├── syncService.ts   # Offline queue + flush
│   │   ├── storage.ts       # localStorage persistence
│   │   └── deckTransform.ts # QR parsing + Master Vault name lookup
│   ├── lib/
│   │   ├── supabase.ts      # Supabase client
│   │   └── utils.ts
│   └── App.tsx
├── supabase/
│   └── schema.sql           # Database schema (run once in the SQL Editor)
├── public/                  # Static assets (PWA manifest, service worker)
└── .github/workflows/       # GitHub Pages deploy
```

## Development

### Prerequisites

- Node.js 18+
- A Supabase project (see Setup above)

### Local Development

```bash
git clone https://github.com/jtrussell/the-archivist.git
cd the-archivist
npm install
npm run dev
```

Open `http://localhost:5173/` and sign in with Google. Make sure
`http://localhost:5173/**` is in your Supabase redirect URLs.

### Build

```bash
npm run build
```

### Deploy

Push to `main` branch or manually trigger the "Deploy to GitHub Pages" workflow in Actions.

## Use Cases

- **Collection Management**: Track which decks are in which storage boxes
- **Game Store Inventory**: Manage deck locations in your store
- **Tournament Organization**: Track deck check-in/check-out
- **Personal Organization**: Know where every deck is at all times
- **Deck Library**: Build a searchable catalog of your collection

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with [Vite](https://vitejs.dev/) and [React](https://react.dev/)
- UI components inspired by [shadcn/ui](https://ui.shadcn.com/)
- QR scanning via [@zxing/browser](https://github.com/zxing-js/browser)
- Backend by [Supabase](https://supabase.com/)
- Inspired by the need to find that one specific KeyForge deck in a pile of 500
