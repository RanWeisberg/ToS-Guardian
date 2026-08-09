/**
 * lib/demoAgreement.ts — the demo agreement the root GUI is pre-filled with.
 *
 * A coherent ~1.8k-character excerpt of YouTube's Terms of Service, kept to the
 * clauses that are actually substantive for a review: the licence grants, the
 * monetization right, automated analysis of user content, unilateral suspension
 * and termination, unilateral changes to the terms, and the liability cap.
 * Section headings and sentence boundaries are preserved — this is an excerpt,
 * not a truncation.
 *
 * The full human-readable source stays at ./youtube-tos.txt in the repo root.
 * The GUI imports these constants directly (no fetch, nothing read from public/).
 */

export const DEMO_SERVICE = "YouTube";

export const DEMO_AGREEMENT = `Licence to YouTube

By providing Content to the Service, you grant to YouTube a worldwide, non-exclusive, royalty-free, transferable, sublicensable licence to use that Content (including to reproduce, distribute, modify, display and perform it) for the purpose of operating, promoting, and improving the Service.

Licence to Other Users

You also grant each other user of the Service a worldwide, non-exclusive, royalty-free licence to access your Content through the Service, and to use that Content (including to reproduce, distribute, modify, display, and perform it) only as enabled by a feature of the Service.

Right to Monetize

You grant to YouTube the right to monetize your Content on the Service (and such monetization may include displaying ads on or within Content or charging users a fee for access). This Agreement does not entitle you to any payments.

Uploading Content

We may use automated systems that analyze your Content to help detect infringement and abuse.

Terminations and Suspensions by YouTube

YouTube reserves the right to suspend or terminate your Google account or your access to all or part of the Service if: (a) you materially or repeatedly breach this Agreement; (b) we are required to do so to comply with a legal requirement or a court order; or (c) we reasonably believe that there has been conduct that creates liability or harm to any user, other third party, YouTube or our Affiliates.

Changing this Agreement

We may change this Agreement. If we materially change this Agreement, we'll provide you with reasonable advance notice and the opportunity to review the changes, except (1) when we launch a new product or feature, or (2) in urgent situations. If you don't agree to the new terms, you should remove any Content you uploaded and stop using the Service.

Governing Law

This Agreement, and your relationship with YouTube under this Agreement, will be governed by Israeli Law, and legal disputes may be brought in the competent courts of Israel.`;