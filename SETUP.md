# The Archivist - Setup Guide

This guide will walk you through setting up The Archivist for deployment to GitHub Pages.

## Prerequisites

- A GitHub account
- A Make.com account (free tier works!)
- Node.js 18+ installed locally (for development)

## Step 1: Make.com Webhook Setup

### 1.1 Create Make.com Account

1. Go to [Make.com](https://www.make.com/)
2. Sign up for a free account (or log in if you have one)
3. The free tier includes 1,000 operations/month, which is plenty for personal use

### 1.2 Create a Scenario

1. In Make.com dashboard, click "Create a new scenario"
2. Add a **Webhooks** module as the first step
   - Choose "Custom webhook"
   - Click "Add" to create a new webhook
   - Give it a name like "Archivist Deck Scans"
   - Copy the webhook URL (you'll need this later)

### 1.3 Configure Data Processing

Add modules to process your scan data. Common options:

**Option A - Google Sheets**:
1. Add "Google Sheets" → "Add a Row" module
2. Connect your Google account
3. Select your spreadsheet
4. Map the fields:
   - Timestamp: `{{scans[].timestamp}}`
   - Deck Data: `{{scans[].deckData}}`
   - Location Tag: `{{scans[].tag}}`

**Option B - Airtable**:
1. Add "Airtable" → "Create a Record" module
2. Connect your Airtable account
3. Select your base and table
4. Map the fields similarly

**Option C - Other Services**:
- Notion
- Monday.com
- Excel Online
- Or any other Make.com integration!

### 1.4 Handle Batch Arrays

Since the webhook sends an array of scans:
1. Add an **Iterator** module after the webhook
2. Connect it to `{{scans}}`
3. This will process each scan individually
4. Connect your data module after the iterator

### 1.5 Save and Activate

1. Click "Save" in the bottom right
2. Toggle the scenario to "Active" (ON)
3. Your webhook is now ready to receive data!

## Step 2: GitHub Repository Setup

### 2.1 Fork or Clone Repository

If you haven't already, fork or clone this repository to your GitHub account.

### 2.2 Enable GitHub Pages

1. In your repository, go to "Settings" → "Pages"
2. Under "Build and deployment":
   - **Source**: Select "GitHub Actions"
3. Save

**Note**: No secrets are required! The webhook URL will be configured in the app UI.

## Step 3: Deploy

### 3.1 Trigger Deployment

The app will automatically deploy when you push to the `main` branch. To deploy manually:

1. Go to "Actions" tab in your repository
2. Click on "Deploy to GitHub Pages" workflow
3. Click "Run workflow"
4. Select the `main` branch
5. Click "Run workflow"

### 3.2 Wait for Deployment

The deployment typically takes 2-3 minutes. You can monitor progress in the "Actions" tab.

### 3.3 Access Your App

Once deployed, your app will be available at:
`https://jtrussell.github.io/the-archivist/`

(Replace `jtrussell` with your GitHub username)

## Step 4: First-Time Use

### 4.1 Configure Webhook

1. Open the deployed app
2. Go to the "Settings" tab
3. Paste your Make.com webhook URL
4. Click "Set"

### 4.2 Start Scanning

1. Go to the "Scan" tab
2. Enter a location tag (e.g., "Storage Box #3457")
3. Click "Start Scanning"
4. Grant camera permissions when prompted
5. Point camera at KeyForge deck QR codes
6. Scans will be queued locally

### 4.3 Send Scans to Webhook

1. Go back to "Settings" tab
2. Click "Send X Scans" button
3. All queued scans will be batch-submitted to your webhook
4. Check your Make.com scenario execution history to confirm

## Development Setup

To run the app locally:

1. Clone the repository
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

## Customization

### Change App Name or Branding

Edit the following files:
- `index.html` - Page title
- `public/manifest.json` - PWA name and description
- `src/App.tsx` - Header title

### Change Repository Name

If you rename the repository, update:
1. `vite.config.ts` - Change `base: '/the-archivist/'` to match your new repo name
2. `public/manifest.json` - Update `start_url` and icon paths

### Customize QR Data Transformation

Edit `src/services/deckTransform.ts`:
- Modify the `transformDeckData()` function
- Add custom parsing logic
- Integrate with external APIs (e.g., Decks of KeyForge)

### Customize Webhook Payload

Edit `src/services/webhookService.ts` if you need to change the data format sent to Make.com.

## Troubleshooting

### Camera Not Working

**Causes**:
- App not served over HTTPS (camera API requires secure context)
- Camera permissions denied
- Wrong camera selected

**Fixes**:
- Ensure app is accessed via HTTPS (GitHub Pages handles this)
- Check browser camera permissions
- Try clicking "Grant Camera Access" again
- On mobile, try landscape orientation

### Webhook Not Receiving Data

**Check**:
1. Is the webhook URL correct?
2. Is your Make.com scenario active (toggled ON)?
3. Check Make.com execution history for errors
4. Check browser console (F12) for network errors
5. Try sending a test request using the browser network tab

### Scans Not Being Queued

**Check**:
1. Is a webhook configured? (Settings tab)
2. Is a location tag entered? (Scan tab)
3. Check browser console for errors
4. Check localStorage in browser DevTools (Application tab → Local Storage)

### Build Fails in GitHub Actions

**Common causes**:
1. Node version mismatch - workflow uses Node 20
2. Dependencies error - check `package.json` for issues
3. Build errors - run `npm run build` locally to test

## Architecture Notes

### Why No Backend?

This app is designed to be:
- **Zero cost** - No server infrastructure to pay for
- **Zero maintenance** - No server to update or monitor
- **Privacy-first** - Data goes directly to YOUR webhook
- **Simple** - Just a static site on GitHub Pages

### Why Make.com?

Make.com provides:
- Free tier with generous limits (1,000 operations/month)
- Visual workflow builder (no coding required)
- Integrations with 1,000+ services
- Built-in error handling and retry logic
- Execution history for debugging

### Batch Submissions

The app queues scans and sends them in batches to:
- Reduce webhook triggers (saves Make.com operations)
- Handle offline scenarios gracefully
- Allow reviewing scans before submission
- Provide better UX (scan multiple items then submit once)

## Security Notes

1. **Webhook URL**: Your webhook URL is stored in localStorage. Anyone with access to your device can see it. This is acceptable because:
   - The webhook only accepts data, it doesn't expose any
   - You control what the webhook does with the data
   - Make.com webhooks can be regenerated anytime if compromised

2. **No Authentication**: The app doesn't require login because:
   - Each user configures their own webhook
   - No centralized data storage
   - No user accounts to manage

3. **Data Privacy**: Your scan data:
   - Never touches our servers (we don't have any!)
   - Goes directly from your browser to your webhook
   - Is stored only in YOUR chosen destination (Google Sheets, etc.)

## Getting Help

If you encounter issues:

1. Check the browser console (F12) for error messages
2. Review the troubleshooting section above
3. Check Make.com execution history for webhook errors
4. Verify your scenario is active and properly configured

## Next Steps

- Customize the deck data transformation logic
- Add additional Make.com modules to enrich your data
- Set up notifications when scans are received
- Create reports or dashboards with your collected data
- Configure PWA icons for better mobile experience

## Example Make.com Scenarios

### Scenario 1: Google Sheets with Notifications

1. Webhooks → Custom Webhook
2. Iterator → `{{scans}}`
3. Google Sheets → Add a Row
4. Gmail → Send an Email (optional, for daily summaries)

### Scenario 2: Airtable with Slack Notifications

1. Webhooks → Custom Webhook
2. Iterator → `{{scans}}`
3. Airtable → Create a Record
4. Slack → Send a Message (when specific tags are used)

### Scenario 3: Multi-Destination

1. Webhooks → Custom Webhook
2. Iterator → `{{scans}}`
3. Router module to split flow:
   - Path 1: Google Sheets (permanent storage)
   - Path 2: Notion (for current inventory)
   - Path 3: Discord (notifications)
