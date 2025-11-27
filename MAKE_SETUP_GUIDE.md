# Make.com Setup Guide - The Archivist

This guide covers setting up your Make.com scenario to receive deck scans and write them to Google Sheets.

## Option 1: Import Blueprint (Recommended)

### Prerequisites
- Make.com account (free tier is fine)
- Google account with access to Google Sheets

### Steps

1. **Log in to Make.com**
   - Go to https://www.make.com/
   - Sign in or create a free account

2. **Import the Blueprint**
   - Click "Scenarios" in the left sidebar
   - Click "Create a new scenario"
   - Click the three dots menu (⋯) at the top
   - Select "Import Blueprint"
   - Upload the `make-blueprint.json` file from this repository

3. **Configure the Webhook**
   - Click on the first module (Custom Webhook)
   - Click "Create a webhook"
   - Name it "The Archivist Webhook"
   - Copy the webhook URL that's generated
   - (Optional) Under "IP restrictions", click "Add item" and add API key validation:
     - Header name: `x-make-apikey`
     - Expected value: Your chosen API key (generate a random string)
   - Click "OK"

4. **Connect Google Sheets**
   - Click on the Google Sheets module (4th module)
   - Click "Create a connection"
   - Sign in with your Google account
   - Grant the necessary permissions

5. **Select Your Spreadsheet**
   - In the Google Sheets module settings:
   - **Spreadsheet**: Select an existing spreadsheet or create a new one
   - **Sheet Name**: Enter the sheet name (e.g., "Deck Scans")
   - **Table contains headers**: Yes

   Make sure your spreadsheet has these column headers in the first row:
   ```
   Timestamp | Deck ID | Deck Name | Tag
   ```

6. **Test the Scenario**
   - Click "Run once" at the bottom
   - The webhook will wait for data
   - Use the test payload below to send a test request
   - Verify a row is added to your Google Sheet

7. **Activate the Scenario**
   - Click the "ON/OFF" toggle at the bottom left to activate
   - Your scenario is now live!

8. **Configure Your App**
   - Copy the webhook URL from step 3
   - Open The Archivist app
   - Go to Settings
   - Paste the webhook URL
   - If you set up API key validation, paste the API key as well
   - Click "Set Webhook"

### Test Payload

Use this to test your webhook (via Postman, curl, or Make.com's "Run Once" with manual JSON):

```json
{
  "scans": [
    {
      "timestamp": "2025-11-22T14:30:00.000Z",
      "deckData": "abc-123-xyz",
      "deckName": "Test Deck",
      "tag": "Storage Box #1"
    },
    {
      "timestamp": "2025-11-22T14:31:00.000Z",
      "deckData": "def-456-uvw",
      "deckName": "",
      "tag": "Storage Box #1"
    }
  ]
}
```

**With curl:**
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-make-apikey: YOUR_API_KEY" \
  -d '{
    "scans": [
      {
        "timestamp": "2025-11-22T14:30:00.000Z",
        "deckData": "abc-123-xyz",
        "deckName": "Test Deck",
        "tag": "Storage Box #1"
      }
    ]
  }'
```

---

## Option 2: Manual Setup

If the blueprint import doesn't work, here's how to set it up manually:

### Step 1: Create Custom Webhook

1. Create a new scenario in Make.com
2. Add a **Webhooks → Custom webhook** module
3. Click "Create a webhook"
4. Name it "The Archivist Webhook"
5. (Optional) Add API key validation:
   - IP restrictions tab
   - Add item
   - Header name: `x-make-apikey`
   - Expected value: Your API key
6. Copy the webhook URL
7. Click "OK"

### Step 2: Add Iterator

1. Click the "+" button after the webhook
2. Search for "Iterator"
3. Select **Flow Control → Iterator**
4. In the Array field, select `scans` from the webhook output
   - Or manually type: `{{1.scans}}` (where 1 is the webhook module number)

### Step 3: Add Google Sheets Module

1. Click the "+" button after the iterator
2. Search for "Google Sheets"
3. Select **Google Sheets → Add a Row**
4. Create or select your Google connection
5. Configure:
   - **Spreadsheet**: Select your spreadsheet
   - **Sheet Name**: Enter your sheet name (must exist)
   - **Table contains headers**: Yes

6. Map the values:
   - **Timestamp**: Click and select `timestamp` from the iterator (module 2)
   - **Deck ID**: Select `deckData` from the iterator
   - **Deck Name**: Select `deckName` from the iterator
   - **Tag**: Select `tag` from the iterator

### Step 4: Add Error Handler (Optional but Recommended)

1. Right-click on the Google Sheets module
2. Select "Add error handler"
3. Add **Tools → Email** module
4. Configure:
   - To: Your email address
   - Subject: `The Archivist - Sync Error`
   - Content:
     ```
     Error syncing deck scans to Google Sheets.

     Error: {{4.message}}

     Failed scan data:
     - Timestamp: {{3.timestamp}}
     - Deck Data: {{3.deckData}}
     - Tag: {{3.tag}}
     ```

### Step 5: Set Scenario Settings

1. Click the scenario settings gear icon (bottom left)
2. Configure:
   - **Max number of results**: 1 (for webhook)
   - **Sequential processing**: Off (for better performance)
   - **Allow storing incomplete executions**: On (for debugging)

### Step 6: Test and Activate

1. Click "Run once"
2. Send test payload to your webhook URL
3. Verify the row appears in Google Sheets
4. Click the ON/OFF toggle to activate

---

## Google Sheets Setup

### Create Your Tracking Spreadsheet

1. Go to Google Sheets
2. Create a new spreadsheet
3. Name it "KeyForge Deck Tracker" (or your preference)
4. In the first row, add these headers:

   ```
   Timestamp | Deck ID | Deck Name | Tag
   ```

5. (Optional) Format the sheet:
   - Freeze the header row: View → Freeze → 1 row
   - Auto-resize columns: Select all → Format → Column width → Fit to data
   - Bold the headers

### Example Sheet Structure

| Timestamp | Deck ID | Deck Name | Tag |
|-----------|---------|-----------|-----|
| 2025-11-22T14:30:00.000Z | abc-123-xyz | The Glorious Captain | Storage Box #1 |
| 2025-11-22T14:31:15.000Z | def-456-uvw | Shadowmage Q | Storage Box #1 |
| 2025-11-22T14:35:42.000Z | ghi-789-rst | | Storage Box #2 |

**Note**: The Deck Name column may be empty initially. Once you implement deck name lookup in the app's `deckTransform.ts`, this column will be populated automatically.

---

## Troubleshooting

### Webhook not receiving data
- Verify the webhook URL is correct in The Archivist settings
- Check that the scenario is activated (toggle is ON)
- Look at "Scenario execution history" in Make.com for errors
- Try sending the test payload directly to the webhook URL using curl

### API key validation failing
- Ensure the API key in The Archivist matches the one in Make.com webhook settings
- Check the header name is exactly `x-make-apikey` (case-sensitive)
- Verify the key has no extra spaces

### Google Sheets errors
- Make sure the sheet name exactly matches what's in the scenario
- Verify the first row contains headers
- Check that your Google account has edit access to the spreadsheet
- Ensure the Google Sheets connection is still valid (reconnect if needed)

### Multiple rows created for one scan
- Check that you have the Iterator module configured correctly
- Verify the Google Sheets module is connected AFTER the iterator
- Make sure you're mapping from the iterator output (module 2), not the webhook (module 1)

### Missing data in spreadsheet
- Verify all four columns have mappings in the Google Sheets module
- For Deck Name, use a formula to handle empty values: `{{if(3.deckName != null; 3.deckName; "")}}`
- Check the iterator is iterating over `{{1.scans}}` correctly

---

## Advanced: Adding Deck Name Lookup

Once you're ready to add automatic deck name lookup via the KeyForge API:

### Option A: Frontend Lookup (Recommended)

Modify `src/services/deckTransform.ts` in The Archivist app to fetch deck names before sending to Make.com. This reduces Make.com operations and keeps your scenario simple.

### Option B: Make.com Lookup

Add an HTTP module between the Iterator and Google Sheets:

1. Add **HTTP → Make a request** module
2. Configure:
   - URL: `https://www.keyforgegame.com/api/decks/{{3.deckData}}/`
   - Method: GET
   - Parse response: Yes

3. Update Google Sheets module:
   - Deck Name: `{{4.data.name}}` (use the HTTP response)

**Note**: This approach uses more Make.com operations (1 per deck scanned).

---

## Usage Tips

### Batch Scanning Workflow
1. Set your current location tag in the app
2. Scan multiple decks (they queue locally)
3. When done scanning, go to Settings
4. Click "Send X Scans" to submit the batch
5. Check your Google Sheet to verify all rows were added

### Make.com Free Tier Limits
- 1,000 operations per month
- Each batch submission = 1 webhook call + N rows added (N = number of scans)
- Example: 5 batches of 10 decks = 5 + 50 = 55 operations
- You can scan hundreds of decks per month on the free tier

### Monitoring
- Check "Scenario execution history" in Make.com regularly
- Set up email notifications for errors (see Step 4 in manual setup)
- Review your Google Sheet periodically for missing or duplicate entries

---

## Blueprint Details

The blueprint includes:

1. **Custom Webhook** (Module 1)
   - Receives POST requests from The Archivist app
   - Optional API key validation via `x-make-apikey` header
   - Expects JSON payload with `scans` array

2. **Iterator** (Module 2)
   - Iterates over the `scans` array from the webhook
   - Each scan is processed individually

3. **Google Sheets - Add Row** (Module 3)
   - Adds one row per scan
   - Maps: timestamp, deckData → Deck ID, deckName → Deck Name, tag → Tag
   - Handles empty deck names gracefully

### Payload Structure Expected

```typescript
{
  scans: Array<{
    timestamp: string      // ISO 8601 format
    deckData: string       // Deck ID or URL
    deckName?: string      // Optional deck name (empty string if not available)
    tag: string           // Location tag
  }>
}
```

---

## Next Steps

After setup:
1. Test with a few scans to verify everything works
2. Scan your deck collection!
3. (Optional) Implement deck name lookup in `deckTransform.ts`
4. (Optional) Add data validation or deduplication in Make.com
5. (Optional) Connect other tools (Airtable, Notion, etc.) instead of or in addition to Google Sheets

---

## Support

- **Make.com Documentation**: https://www.make.com/en/help
- **The Archivist Issues**: https://github.com/jtrussell/the-archivist/issues
- **Google Sheets API**: https://developers.google.com/sheets/api

Happy deck tracking!
