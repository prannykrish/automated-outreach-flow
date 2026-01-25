# Email Webhook & Tracking System

This document provides a complete guide to setting up email tracking for opens and replies using Resend webhooks.

## Quick Start

### 1. Get Resend API Key
- Go to [https://resend.com](https://resend.com)
- Sign up and verify a domain
- Get your API key from the dashboard

### 2. Add Environment Variables
Create or update `.env.local`:
```env
VITE_RESEND_API_KEY=re_xxxxxxxxxxxxx
VITE_RESEND_FROM_EMAIL=noreply@yourdomain.com
```

### 3. Deploy Edge Function
```bash
supabase functions deploy handle-resend-webhooks
```

After deployment, you'll see your function URL (save this!)

### 4. Configure Resend Webhook
1. Go to [Resend Dashboard](https://dashboard.resend.com)
2. Navigate to Webhooks
3. Click "Add Webhook"
4. Paste your function URL from step 3
5. Select events: delivered, opened, clicked, replied, bounced, complained
6. Save

### 5. Test It Out
- Go to Settings page in your app
- Test email sending and webhook delivery
- Add a customer and send them an email
- Track opens/replies in the Pipeline and Insights pages

## How It Works

```
Customer adds email to sequence
    ↓
System scheduled email send
    ↓
Resend API sends email (stores resend_id)
    ↓
Email delivered to recipient
    ↓
Recipient opens/replies (Resend detects this)
    ↓
Resend sends webhook to your Edge Function
    ↓
Edge Function updates email_logs table (opened_at, replied_at)
    ↓
You see it in Pipeline & Insights!
```

## Architecture

### Components

**1. Frontend**
- `src/lib/resend.ts` - Email sending utilities
- `src/components/EmailTrackingSetup.tsx` - Setup wizard
- `src/pages/Settings.tsx` - Settings page

**2. Backend**
- `supabase/functions/handle-resend-webhooks/` - Webhook handler (Edge Function)
- `email_logs` table - Stores email tracking data

**3. Database**
- `email_logs.resend_id` - Links to Resend's email ID
- `email_logs.opened_at` - When email was opened (via webhook)
- `email_logs.replied_at` - When email was replied to (via webhook)
- `email_logs.status` - sent, failed, etc.

### Event Flow

#### Email Opened
```
Resend detects open
  → Sends webhook: { type: "email.opened", email: { id: "resend-id" }, created_at: "..." }
    → Edge Function receives it
      → Finds email_logs entry with that resend_id
        → Updates: opened_at = webhook timestamp
          → Real-time update in Pipeline & Insights
```

#### Email Replied
```
Resend detects reply (via email parsing)
  → Sends webhook: { type: "email.replied", ... }
    → Edge Function processes it
      → Updates: replied_at = webhook timestamp
```

#### Email Failed
```
Resend detects bounce/complaint
  → Sends webhook: { type: "email.bounced" } or { type: "email.complained" }
    → Edge Function processes it
      → Updates: status = "failed"
```

## Email Events Tracked

| Event | What It Means | Updates |
|-------|---------------|---------|
| `email.delivered` | Email reached recipient's mail server | status = "sent" |
| `email.opened` | Recipient opened the email | opened_at timestamp |
| `email.clicked` | Recipient clicked a link | opened_at timestamp |
| `email.replied` | Recipient replied to email | replied_at timestamp |
| `email.bounced` | Email couldn't be delivered | status = "failed" |
| `email.complained` | Recipient marked as spam | status = "failed" |

## Sending Emails

### Using the Helper Function

```typescript
import { sendEmailViaResend } from "@/lib/resend";

const result = await sendEmailViaResend({
  to: "customer@example.com",
  subject: "Email Subject",
  body: "<h1>Email HTML</h1>",
  customerId: "uuid-here",
  templateId: "uuid-here",
  stepId: "uuid-here",
});

console.log(result.resendId); // Resend's unique email ID
```

### What It Does

1. ✅ Calls Resend API to send email
2. ✅ Gets unique `resend_id` from Resend
3. ✅ Logs to email_logs table with resend_id
4. ✅ Handles errors and logs failures

## Webhook Handler Details

**Location:** `supabase/functions/handle-resend-webhooks/index.ts`

**What It Does:**
- Receives webhook events from Resend
- Finds corresponding email_logs entry using resend_id
- Updates tracking fields based on event type
- Returns 200 OK if successful

**Event Type Handling:**
```typescript
if (event.type === "email.opened") {
  // Update opened_at timestamp
}
else if (event.type === "email.replied") {
  // Update replied_at timestamp
}
else if (event.type === "email.bounced" || "email.complained") {
  // Mark as failed
}
```

## Troubleshooting

### "No emails showing as opened/replied in Pipeline"

**Problem:** Webhooks not being processed

**Solutions:**
1. Check Resend dashboard webhook logs
   - Go to Webhooks → Click your webhook → View logs
   - Look for failures (red icons)

2. Verify webhook is correctly configured
   - URL is correct and accessible
   - Events are selected (opened, replied, etc.)

3. Check Edge Function logs
   ```bash
   supabase functions logs handle-resend-webhooks
   ```

4. Verify resend_id is being saved
   - Check email_logs table
   - Should have resend_id value for sent emails

### "Getting CORS errors"

**Solution:** The Edge Function includes proper CORS headers. If you're still getting errors:
1. Check the URL is correct (no trailing slash)
2. Verify in Resend dashboard the webhook is getting responses
3. Check Edge Function logs for actual error

### "Test email not sending"

**Problem:** Email sends but doesn't appear in email_logs

**Solutions:**
1. Verify VITE_RESEND_API_KEY is valid
   - Try creating an API key with different permissions
2. Check Resend API response in browser console
3. Verify database permissions allow inserts to email_logs

### "Webhook gets 404"

**Problem:** Edge Function returns 404 errors

**Solutions:**
1. Verify function was deployed:
   ```bash
   supabase functions list
   ```
   Should show: `handle-resend-webhooks   live`

2. Check URL format:
   - Should be: `https://your-project.supabase.co/functions/v1/handle-resend-webhooks`
   - NOT: `https://your-project.supabase.co/functions/handle-resend-webhooks`

3. Redeploy if needed:
   ```bash
   supabase functions deploy handle-resend-webhooks
   ```

## Testing Webhooks Locally

Use Postman or curl to test your webhook:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/handle-resend-webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email.opened",
    "email": { "id": "resend-id-from-email-logs" },
    "created_at": "2026-01-25T12:00:00Z"
  }'
```

Response should be: `{"success":true,"event":"email.opened"}`

## Monitoring & Analytics

### In Pipeline Page
- Opens show with Eye icon + timestamp
- Replies show with MessageSquare icon + timestamp
- Status badge shows delivery status

### In Insights Page
- Open rate calculation (opened / sent × 100)
- Reply rate calculation (replied / sent × 100)
- Funnel visualization (sent → opened → replied)
- Performance breakdown by sequence/template
- Email volume trends over time

## Production Checklist

- [ ] VITE_RESEND_API_KEY added to production .env
- [ ] VITE_RESEND_FROM_EMAIL verified in Resend
- [ ] Edge Function deployed to production
- [ ] Webhook URL verified in Resend dashboard
- [ ] Test email sent and opened
- [ ] Webhook events verified in Resend logs
- [ ] Data appearing in Pipeline page
- [ ] Analytics showing in Insights page

## Advanced Configuration

### Custom Email Headers
Modify `src/lib/resend.ts` to add custom headers:
```typescript
const response = await fetch("https://api.resend.com/emails", {
  body: JSON.stringify({
    // ... existing fields
    headers: {
      "X-Custom-Header": "value"
    }
  })
});
```

### Webhook Signature Verification
The edge function has signature verification placeholder. To enable:
1. Get signing key from Resend dashboard
2. Implement HMAC-SHA256 verification
3. Add to env variables

### Rate Limiting
Add to Edge Function to prevent abuse:
```typescript
// Add Redis rate limiting or similar
const rateLimitKey = `webhook:${event.email.id}`;
```

## Support

For issues:
1. Check Resend webhook logs (Dashboard → Webhooks)
2. Check Edge Function logs: `supabase functions logs handle-resend-webhooks`
3. Verify database entries in email_logs table
4. Check browser console for frontend errors

## Resources

- [Resend Documentation](https://resend.com/docs)
- [Resend Webhooks](https://resend.com/docs/webhook)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Email Best Practices](https://resend.com/docs/best-practices)
