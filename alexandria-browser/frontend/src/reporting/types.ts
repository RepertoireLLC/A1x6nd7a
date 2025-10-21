import type { ReportReason } from "./options";

export interface ReportSubmissionPayload {
  identifier: string;
  archiveUrl: string;
  reason: ReportReason;
  message?: string;
  title?: string;
}

export interface ReportResponse {
  success: boolean;
  messageId?: string | null;
  error?: string;
  details?: string;
}

export type ReportSubmitHandler = (payload: ReportSubmissionPayload) => Promise<void>;
