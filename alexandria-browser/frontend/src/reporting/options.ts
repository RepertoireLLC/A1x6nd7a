export const REPORT_REASONS = [
  { value: "inappropriate-content", label: "Inappropriate content" },
  { value: "copyright-violation", label: "Copyright violation" },
  { value: "broken-link", label: "Broken link or missing item" },
  { value: "spam-or-malware", label: "Spam, malware, or misleading" },
  { value: "other", label: "Other" }
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const DEFAULT_REPORT_REASON: ReportReason = REPORT_REASONS[0].value;
