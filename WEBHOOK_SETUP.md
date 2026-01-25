# Email Webhook & Tracking Setup Guide

This guide walks you through setting up Resend webhooks to track email opens and replies in your application.

## Prerequisites

1. **Resend Account** - Sign up at [https://resend.com](https://resend.com)
2. **Resend API Key** - Get it from your Resend dashboard
3. **Verified Domain** - Set up a sending domain in Resend

## Step 1: Configure Environment Variables

Add these to your `.env.local` file:

```env
VITE_RESEND_API_KEY=your_resend_api_key_here
VITE_RESEND_FROM_EMAIL=noreply@yourdomain.com
```

## Step 2: Deploy Supabase Edge Function

The webhook handler is located at: `supabase/functions/handle-resend-webhooks/index.ts`

Deploy it using:

```bash
supabase functions deploy handle-resend-webhooks
```

After deployment, you'll get a function URL that looks like:
```
https://your-project.supabase.co/functions/v1/handle-resend-webhooks
```

## Step 3: Configure Resend Webhooks

1. Go to your [Resend Dashboard](https://dashboard.resend.com)
2. Navigate to **Webhooks** section
3. Click **"Add Webhook"**
4. Paste your function URL from Step 2
5. Select these events to track:
   - ✅ `email.delivered` - Email was delivered
   - ✅ `email.opened` - Email was opened by recipient
   - ✅ `email.clicked` - Link in email was clicked (also marks as opened)
   - ✅ `email.replied` - Recipient replied to the email
   - ✅ `email.bounced` - Email bounced
   - ✅ `email.complained` - Email marked as spam

6. Click **"Create Webhook"**

## Step 4: Test the Integration

You can test by:

1. Adding a customer and assigning them to a sequence
2. The scheduled email will be sent via Resend with tracking enabled
3. Check the **Pipeline** page - you should see open and reply tracking as emails are engaged with
4. Go to **Insights** to see analytics updating in real-time

## What Gets Tracked

| Event | Updates |
|-------|---------|
| Email Delivered | Status = "sent" |
| Email Opened | `opened_at` timestamp |
| Email Clicked | `opened_at` timestamp |
| Email Replied | `replied_at` timestamp |
| Email Bounced | Status = "failed" |
| Email Complained | Status = "failed" |

## How to Send Emails

The `sendEmailViaResend()` function in `src/lib/resend.ts` handles:

1. Calling Resend API to send the email
2. Getting the unique `resend_id` from Resend
3. Logging the email in your database
4. Capturing any errors

Usage example:

```typescript
import { sendEmailViaResend } from "@/lib/resend";

await sendEmailViaResend({
  to: customer.email,
  subject: template.subject,
  body: template.body,
  customerId: customer.id,
  templateId: template.id,
  stepId: step.id,
});
```

## Troubleshooting

### Webhooks not updating data

1. **Check webhook delivery in Resend**: 
   - Dashboard → Webhooks → Click your webhook → View logs
   - Look for failed deliveries (red status)

2. **Verify function URL is correct**:
   ```bash
   supabase functions list
   ```

3. **Check function logs**:
   ```bash
   supabase functions logs handle-resend-webhooks
   ```

4. **Test webhook manually**:
   Use Postman or curl to send a test event to your function URL

### Emails not sending

1. Verify `VITE_RESEND_API_KEY` is valid and has email sending permissions
2. Check that `VITE_RESEND_FROM_EMAIL` is verified in Resend dashboard
3. Check browser console for error messages
4. Review `email_logs` table for failed records with error messages

### Data not appearing in Insights

1. Make sure webhook events are being received (check Resend dashboard logs)
2. Verify `resend_id` values are being saved in `email_logs`
3. Allow a few seconds for webhooks to process after email is opened/replied

## Next Steps

After webhooks are set up and working:

1. **Monitor your Insights dashboard** - See open rates, reply rates, and performance by sequence/template
2. **A/B Test Templates** - Create variations and compare performance
3. **Optimize Send Times** - Analyze when your audience is most responsive
4. **Set up Alerts** - Create custom queries in Supabase to notify you of high-engagement emails

## Additional Resources

- [Resend Documentation](https://resend.com/docs)
- [Resend Webhooks Guide](https://resend.com/docs/webhook)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
