export type EmailEnv = NodeJS.ProcessEnv;

export type EmailAttachment = { filename: string; contentType: string; bytes: Uint8Array };

export type EmailMessage = { from: string; to: string[]; subject: string; text: string; attachments?: EmailAttachment[] };

function attachmentBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function emailSetup(env: EmailEnv = process.env): { configured: boolean; provider: string; from: string; missing: string[] } {
  const from = env.SPIKE_EMAIL_FROM?.trim() ?? "";
  const provider = (env.SPIKE_EMAIL_PROVIDER?.trim() || "").toLowerCase();
  const missing: string[] = [];
  if (!from) missing.push("SPIKE_EMAIL_FROM");
  if (!provider) missing.push("SPIKE_EMAIL_PROVIDER");
  if (provider === "resend" && !env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (provider === "postmark" && !env.POSTMARK_SERVER_TOKEN?.trim()) missing.push("POSTMARK_SERVER_TOKEN");
  if (provider === "smtp" && !env.SMTP_HOST?.trim()) missing.push("SMTP_HOST");
  if (provider === "ses" && !env.SPIKE_SES_REGION?.trim()) missing.push("SPIKE_SES_REGION");
  if (provider && !["resend", "postmark", "smtp", "ses"].includes(provider)) missing.push("SPIKE_EMAIL_PROVIDER");
  return { configured: missing.length === 0 && Boolean(provider && from), provider, from, missing };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function deliverEmail(message: EmailMessage, env: EmailEnv = process.env, fetchImpl: FetchLike = fetch): Promise<{ ok: boolean; detail: string }> {
  const setup = emailSetup(env);
  if (!setup.configured) return { ok: false, detail: "Email is not configured." };
  if (setup.provider === "resend") {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        attachments: (message.attachments ?? []).map((file) => ({
          filename: file.filename,
          content: attachmentBase64(file.bytes),
        })),
      }),
    });
    const text = await response.text();
    return response.ok ? { ok: true, detail: "Sent through Resend." } : { ok: false, detail: text.slice(0, 180) };
  }
  if (setup.provider === "postmark") {
    const response = await fetchImpl("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN ?? "", "content-type": "application/json" },
      body: JSON.stringify({
        From: message.from,
        To: message.to.join(","),
        Subject: message.subject,
        TextBody: message.text,
        Attachments: (message.attachments ?? []).map((file) => ({
          Name: file.filename,
          Content: attachmentBase64(file.bytes),
          ContentType: file.contentType,
        })),
      }),
    });
    const text = await response.text();
    return response.ok ? { ok: true, detail: "Sent through Postmark." } : { ok: false, detail: text.slice(0, 180) };
  }
  return { ok: false, detail: `${setup.provider} is selected, but this server can send through Resend or Postmark from here. SMTP and SES need those hosts set and a mailer the process can reach.` };
}
