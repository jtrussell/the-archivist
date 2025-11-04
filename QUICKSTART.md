# Quick Start Guide

Get The Archivist running locally in under 5 minutes!

## Prerequisites

- Node.js 18+ installed
- A web browser with camera access
- A Make.com account (free tier works!)

## 1. Install Dependencies

```bash
npm install
```

## 2. Set Up Make.com Webhook (One-Time)

### Create a Make.com Scenario

1. Go to [Make.com](https://www.make.com/) and sign in (or create a free account)
2. Create a new scenario
3. Add a **Webhooks** module as the first step
4. Choose "Custom webhook"
5. Click "Add" to create a new webhook
6. Copy the webhook URL (looks like `https://hook.us1.make.com/...`)
7. Add your data processing modules (Google Sheets, Airtable, etc.)
8. In your data module, map the incoming fields:
   - `{{scans[].tag}}` - Location tag
   - `{{scans[].deckData}}` - Deck information
   - `{{scans[].timestamp}}` - Scan timestamp
9. Save and activate your scenario

**Note**: The webhook receives an array of scans, so you'll want to use an iterator in Make.com to process each scan individually.

## 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) in your browser.

## 4. First Use

1. **Configure Webhook**: Go to Settings tab and paste your Make.com webhook URL
2. **Enter Location Tag**: Go to Scan tab, enter a location (e.g., "Box #1")
3. **Start Scanning**: Click "Start Scanning" and point camera at QR codes
4. **Send to Webhook**: Go back to Settings and click "Send X Scans" to batch submit

## Testing Without QR Codes

To test without physical KeyForge decks:

1. Generate test QR codes at [QR Code Generator](https://www.qr-code-generator.com/)
2. Use any text (e.g., "test-deck-123")
3. Scan the generated QR code
4. Check your Make.com scenario execution history

## Project Structure

```
src/
├── components/       # React components
│   ├── ui/          # Base UI components (Button, Input, Card)
│   ├── ScanView.tsx # Main scanning interface
│   └── SettingsView.tsx
├── services/        # Core logic
│   ├── webhookService.ts # Webhook submission
│   ├── syncService.ts    # Batch queue
│   └── deckTransform.ts  # Customize this!
└── App.tsx          # Main app
```

## Customizing Deck Data Transform

Edit `src/services/deckTransform.ts`:

```typescript
export async function transformDeckData(qrData: string): Promise<string> {
  // Example: Extract deck ID from KeyForge URL
  const match = qrData.match(/deck-details\/([^/?]+)/)
  if (match) {
    return match[1]
  }

  // Or fetch additional data:
  // const response = await fetch(`https://api.example.com/decks/${deckId}`)
  // const data = await response.json()
  // return `${data.name} - ${deckId}`

  return qrData // Return raw data by default
}
```

## Common Commands

```bash
# Development
npm run dev          # Start dev server

# Build
npm run build        # Build for production
npm run preview      # Preview production build

# Type checking
npm run lint         # Run ESLint
```

## Troubleshooting

### Camera not working

**Causes**:
- Browser doesn't have camera permission
- Not using HTTPS (localhost is exempt)
- Camera in use by another app

**Fix**:
1. Grant camera permissions in browser
2. Close other apps using camera
3. Try different browser

### Webhook failing

**Check**:
1. Is the webhook URL correct?
2. Is your Make.com scenario active?
3. Check Make.com execution history for errors
4. Check browser console for network errors

### Build errors

**Fix**: Delete `node_modules` and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

- Customize the QR data transformation logic
- Configure your Make.com scenario to save to your preferred destination
- Change the UI styling/theme
- Deploy to GitHub Pages (see SETUP.md)

## Development Tips

- The dev server supports hot reload - changes appear instantly
- Check browser console for errors and debug info
- Use React DevTools browser extension for component debugging
- Scans are queued in localStorage (check Application tab in DevTools)
- Batch submission reduces webhook triggers and saves on Make.com operations

## Ready to Deploy?

See [SETUP.md](./SETUP.md) for GitHub Pages deployment instructions.

---

**Need help?** Check the browser console first - it usually shows helpful error messages!
