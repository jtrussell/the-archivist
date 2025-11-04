# The Archivist

A minimal-footprint web application for tracking KeyForge deck locations by scanning QR codes.

## Features

- **QR Code Scanning**: Use your device camera to scan KeyForge deck QR codes
- **Location Tagging**: Associate decks with custom location tags (e.g., "Storage Box #3457")
- **Webhook Integration**: Send scan data to Make.com for flexible storage options
- **Batch Submissions**: Queue scans locally and submit in batches to reduce API calls
- **Offline Support**: Scans are queued when offline and synced when online
- **PWA**: Install as a mobile app for quick access
- **Zero Infrastructure**: No backend servers, completely client-side
- **Free**: Uses only free services (GitHub Pages + Make.com free tier)

## Quick Start

1. Visit the deployed app: `https://jtrussell.github.io/the-archivist/`
2. Configure your Make.com webhook URL in Settings
3. Enter a location tag
4. Start scanning!
5. Send batched scans to your webhook

## Setup

See [SETUP.md](./SETUP.md) for detailed deployment instructions.

### Quick Setup Summary

1. **Make.com**:
   - Create a free account
   - Create a scenario with a custom webhook
   - Add data processing modules (Google Sheets, Airtable, etc.)
   - Copy the webhook URL

2. **GitHub**:
   - Fork or clone this repository
   - Enable GitHub Pages
   - Deploy via Actions (no secrets required!)

3. **First Use**:
   - Configure webhook URL in Settings
   - Enter a location tag
   - Start scanning decks!
   - Submit scans in batches

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui components
- **QR Scanning**: @zxing/browser
- **Data Submission**: Make.com webhooks
- **Hosting**: GitHub Pages
- **PWA**: Service Worker + Web Manifest

## Architecture

This app is designed with zero backend infrastructure:

- **Client-side only**: All logic runs in the browser
- **Webhook-based**: No authentication needed, just configure your webhook
- **Batch processing**: Reduce API calls by submitting scans in batches
- **Offline-first**: Scans are queued locally and synced when online
- **User-owned data**: Everything is sent to YOUR webhook and stored wherever you choose

## Project Structure

```
the-archivist/
├── src/
│   ├── components/         # React components
│   │   ├── ui/            # shadcn/ui base components
│   │   ├── QRScanner.tsx  # QR code scanner
│   │   ├── ScanView.tsx   # Main scanning interface
│   │   └── SettingsView.tsx
│   ├── services/          # Core services
│   │   ├── webhookService.ts  # Webhook submission
│   │   ├── syncService.ts     # Batch queue management
│   │   ├── storage.ts         # localStorage persistence
│   │   └── deckTransform.ts   # QR data transformation
│   ├── lib/               # Utilities
│   └── App.tsx            # Main app component
├── public/                # Static assets
│   ├── manifest.json      # PWA manifest
│   └── sw.js             # Service worker
└── .github/workflows/     # GitHub Actions
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- A Make.com account (for testing webhooks)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/jtrussell/the-archivist.git
cd the-archivist
```

2. Install dependencies:
```bash
npm install
```

3. Start dev server:
```bash
npm run dev
```

4. Open `http://localhost:5173/` in your browser

5. Configure your webhook URL in the Settings tab

### Build

```bash
npm run build
```

### Deploy

Push to `main` branch or manually trigger the "Deploy to GitHub Pages" workflow in Actions.

## Customization

### QR Data Transformation

The app includes a placeholder transformation function in `src/services/deckTransform.ts`. Customize this to:

- Extract deck IDs from URLs
- Fetch deck names from external APIs
- Parse additional metadata
- Validate deck data

Example:
```typescript
export async function transformDeckData(qrData: string): Promise<string> {
  // Extract deck ID from KeyForge URL
  const match = qrData.match(/deck-details\/([^/?]+)/)
  if (match) {
    const deckId = match[1]

    // Optionally: fetch deck name from API
    // const deckName = await fetchDeckName(deckId)
    // return `${deckId} - ${deckName}`

    return deckId
  }

  return qrData
}
```

### Webhook Payload

The app sends data in this format:
```json
{
  "scans": [
    {
      "tag": "Storage Box #3457",
      "deckData": "abc-123-xyz",
      "timestamp": "2025-11-04T12:34:56.789Z"
    }
  ]
}
```

You can customize this in `src/services/webhookService.ts`.

### Make.com Scenario Examples

**Google Sheets**:
1. Webhook → Custom Webhook
2. Iterator → `{{scans}}`
3. Google Sheets → Add a Row

**Airtable with Slack Notifications**:
1. Webhook → Custom Webhook
2. Iterator → `{{scans}}`
3. Airtable → Create a Record
4. Slack → Send a Message

## Use Cases

- **Collection Management**: Track which decks are in which storage boxes
- **Game Store Inventory**: Manage deck locations in your store
- **Tournament Organization**: Track deck check-in/check-out
- **Personal Organization**: Know where every deck is at all times
- **Deck Library**: Build a searchable catalog of your collection

## Why Make.com?

- **Free tier**: 1,000 operations/month (plenty for personal use)
- **No coding**: Visual workflow builder
- **Flexible**: 1,000+ integrations available
- **Reliable**: Built-in error handling and retry logic
- **Debuggable**: Execution history for troubleshooting

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with [Vite](https://vitejs.dev/) and [React](https://react.dev/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- QR scanning via [@zxing/browser](https://github.com/zxing-js/browser)
- Webhook automation by [Make.com](https://www.make.com/)
- Inspired by the need to find that one specific KeyForge deck in a pile of 500

## Support

For setup help, see [SETUP.md](./SETUP.md) or [QUICKSTART.md](./QUICKSTART.md).

For issues or questions, please open a GitHub issue.
