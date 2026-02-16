import { supabase } from "@/integrations/supabase/client";

const RESEND_API_KEY = import.meta.env.VITE_RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = import.meta.env.VITE_RESEND_FROM_EMAIL || import.meta.env.RESEND_FROM_EMAIL || "pranav@pranav-k.com";

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  customerId: string;
  templateId: string;
  stepId: string;
}

export async function sendEmailViaResend(params: SendEmailParams) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  try {
    // Call Resend API to send email
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.body,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Resend API error: ${error.message}`);
    }

    const data = (await response.json()) as any;
    const resendId = data.id;

    // fetch customer to include user_id on the log
    const { data: customerRow } = await supabase.from("customers").select("user_id").eq("id", params.customerId).maybeSingle();

    // Log the email send
    const { error: logError } = await supabase.from("email_logs").insert({
      customer_id: params.customerId,
      template_id: params.templateId,
      status: "sent",
      sent_at: new Date().toISOString(),
      resend_id: resendId,
      user_id: customerRow?.user_id ?? null,
    });

    if (logError) {
      console.error("Failed to log email:", logError);
    }

    return { success: true, resendId };
  } catch (error) {
    console.error("Failed to send email via Resend:", error);

    // fetch customer to include user_id on the failed log
    const { data: failedCustomerRow } = await supabase.from("customers").select("user_id").eq("id", params.customerId).maybeSingle();

    // Log the failed send
    const { error: logError } = await supabase.from("email_logs").insert({
      customer_id: params.customerId,
      template_id: params.templateId,
      status: "failed",
      created_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Unknown error",
      user_id: failedCustomerRow?.user_id ?? null,
    });

    if (logError) {
      console.error("Failed to log failed email:", logError);
    }

    throw error;
  }
}

export function validateResendConfig(): { valid: boolean; message?: string } {
  if (!RESEND_API_KEY) {
    return {
      valid: false,
      message: "VITE_RESEND_API_KEY is not configured in your .env file",
    };
  }

  if (!RESEND_FROM_EMAIL) {
    return {
      valid: false,
      message: "VITE_RESEND_FROM_EMAIL is not configured in your .env file",
    };
  }

  return { valid: true };
}
