/**
 * components/report-detail/sampleReport.ts
 *
 * Realistic placeholder data for <ReportDetail />, typed against the real backend
 * contract (lib/contracts.ts) — full MaterialFinding → DiffChange →
 * ClauseCaseClassification → MatchedCase shapes, no invented fields. Content
 * mirrors the Claude Design handoff so the screen previews faithfully.
 *
 * This is a placeholder only. It will be replaced by live ReportComposer /
 * MaterialityJudge output when the screen is wired in a later step.
 */

import type { MaterialFinding } from "@/lib/contracts";
import type { ReportDetailProps } from "./ReportDetail";

const findings: MaterialFinding[] = [
  {
    case_id: "content-license-granted",
    classification: "neutral",
    weight: 40,
    reason:
      "By uploading files, you grant Acme a licence to store, copy, and process your content. Standard for cloud storage, but it means your files aren't entirely private to you.",
    change: {
      type: "added",
      case_id: "content-license-granted",
      before: null,
      after: {
        clause_id: "c1",
        clause_text:
          "You grant Acme a worldwide, non-exclusive licence to host, store, reproduce, and process content you upload for the purpose of operating and improving the service.",
        cases: [
          {
            case_id: "content-license-granted",
            title: "Content licence granted to the service",
            classification: "neutral",
            weight: 40,
            topic: "Ownership",
            confidence: 0.88,
          },
        ],
      },
      summary: "Acme can use your content to run and improve the service",
    },
  },
  {
    case_id: "data-shared-advertising",
    classification: "bad",
    weight: 75,
    reason:
      "Acme's terms allow sharing some of your personal data with third-party advertisers. This is the kind of term you told us you care about.",
    change: {
      type: "added",
      case_id: "data-shared-advertising",
      before: null,
      after: {
        clause_id: "c2",
        clause_text:
          "We may share certain personal information with advertising partners to deliver and measure relevant ads.",
        cases: [
          {
            case_id: "data-shared-advertising",
            title: "Personal data shared with third parties for advertising",
            classification: "bad",
            weight: 75,
            topic: "Data Collection",
            confidence: 0.91,
          },
        ],
      },
      summary: "Your data may be shared with advertising partners",
    },
  },
  {
    case_id: "unilateral-terms-change",
    classification: "bad",
    weight: 70,
    reason:
      "Acme reserves the right to update this agreement whenever it likes, and continued use counts as acceptance. That's exactly what ToS Guardian will keep watching for you.",
    change: {
      type: "added",
      case_id: "unilateral-terms-change",
      before: null,
      after: {
        clause_id: "c3",
        clause_text:
          "Acme may modify these terms at any time. Your continued use of the service after changes take effect constitutes acceptance of the revised terms.",
        cases: [
          {
            case_id: "unilateral-terms-change",
            title: "Terms can be changed unilaterally at any time",
            classification: "bad",
            weight: 70,
            topic: "Changes to Terms",
            confidence: 0.86,
          },
        ],
      },
      summary: "Acme can change these terms at any time",
    },
  },
];

export const sampleReport: ReportDetailProps = {
  service: "Acme Cloud",
  category: "cloud storage",
  reviewedLabel: "just now",
  findings,
};
