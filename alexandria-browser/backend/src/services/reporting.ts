import nodemailer from "nodemailer";

import { getEnv } from "../utils/env";

export const REPORT_REASON_VALUES = [
  "inappropriate-content",
  "copyright-violation",
  "broken-link",
  "spam-or-malware",
  "other"
] as const;

export type ReportReason = (typeof REPORT_REASON_VALUES)[number];

const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  "inappropriate-content": "Inappropriate content",
  "copyright-violation": "Copyright violation",
  "broken-link": "Broken link or missing item",
  "spam-or-malware": "Spam, malware, or misleading",
  other: "Other"
};

const REPORT_REASON_SET = new Set<ReportReason>(REPORT_REASON_VALUES);

export interface ReportSubmission {
  identifier: string;
  archiveUrl: string;
  reason: ReportReason;
  message?: string;
  title?: string;
}

export interface ReportDispatchResult {
  messageId?: string;
}

let cachedTransport: nodemailer.Transporter | null = null;

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function createTransport(): nodemailer.Transporter {
  if (cachedTransport) {
    return cachedTransport;
  }

  const smtpUrl = getEnv("SMTP_URL");
  if (smtpUrl) {
    cachedTransport = nodemailer.createTransport(smtpUrl);
    return cachedTransport;
  }

  const host = getEnv("SMTP_HOST");
  if (host) {
    const port = parsePort(getEnv("SMTP_PORT"));
    const secure = parseBoolean(getEnv("SMTP_SECURE"));
    const user = getEnv("SMTP_USER");
    const pass = getEnv("SMTP_PASS");

    cachedTransport = nodemailer.createTransport({
      host,
      port: port ?? 587,
      secure: secure === undefined ? false : secure,
      auth: user && pass ? { user, pass } : undefined
    });
    return cachedTransport;
  }

  const service = getEnv("SMTP_SERVICE");
  if (service) {
    const user = getEnv("SMTP_USER");
    const pass = getEnv("SMTP_PASS");
    cachedTransport = nodemailer.createTransport({
      service,
      auth: user && pass ? { user, pass } : undefined
    });
    return cachedTransport;
  }

  console.warn(
    "SMTP configuration not provided. Falling back to JSON transport for Alexandria Browser report emails."
  );
  cachedTransport = nodemailer.createTransport({ jsonTransport: true });
  return cachedTransport;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'\"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function formatMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

export function isValidReportReason(value: string): value is ReportReason {
  return REPORT_REASON_SET.has(value as ReportReason);
}

export function describeReason(reason: ReportReason): string {
  return REPORT_REASON_LABELS[reason] ?? reason;
}

export async function sendReportEmail(submission: ReportSubmission): Promise<ReportDispatchResult> {
  const transporter = createTransport();
  const recipient = getEnv("REPORT_RECIPIENT") ?? "info@archive.org";
  const fromAddress =
    getEnv("REPORT_FROM_ADDRESS") ?? "Alexandria Browser <no-reply@alexandria-browser.local>";
  const subject = getEnv("REPORT_SUBJECT") ?? "Content Report – Alexandria Browser";
  const timestamp = new Date().toISOString();
  const reasonLabel = describeReason(submission.reason);

  const trimmedMessage = submission.message?.trim();

  const textSections = [
    "An Alexandria Browser user submitted a content report.",
    `Identifier: ${submission.identifier}`,
    `Title: ${submission.title ?? "(not provided)"}`,
    `Archive URL: ${submission.archiveUrl}`,
    `Reason: ${reasonLabel}`,
    trimmedMessage ? `User message:\n${trimmedMessage}` : "User message: (not provided)",
    `Submitted at: ${timestamp}`
  ];

  const htmlSections = [
    "<p>An Alexandria Browser user submitted a content report.</p>",
    "<ul>",
    `<li><strong>Identifier:</strong> ${escapeHtml(submission.identifier)}</li>`,
    `<li><strong>Title:</strong> ${escapeHtml(submission.title ?? "(not provided)")}</li>`,
    `<li><strong>Archive URL:</strong> <a href="${escapeHtml(submission.archiveUrl)}">${escapeHtml(
      submission.archiveUrl
    )}</a></li>`,
    `<li><strong>Reason:</strong> ${escapeHtml(reasonLabel)}</li>`,
    "</ul>",
    trimmedMessage
      ? `<p><strong>User message:</strong></p><p>${formatMultilineHtml(trimmedMessage)}</p>`
      : "<p><strong>User message:</strong> <em>Not provided.</em></p>",
    `<p><em>Submitted at: ${escapeHtml(timestamp)}</em></p>`
  ];

  const info = await transporter.sendMail({
    to: recipient,
    from: fromAddress,
    subject,
    text: textSections.join("\n\n"),
    html: htmlSections.join("\n")
  });

  return { messageId: typeof info.messageId === "string" ? info.messageId : undefined };
}
