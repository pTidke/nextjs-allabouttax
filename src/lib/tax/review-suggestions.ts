import { createHash } from "node:crypto";
import { reviewSections } from "./review-sections";

export function suggestedReview(url: string, text: string) {
  // Checked against the official notification. Any changed extraction disables
  // the draft; legal status and commencement still require reviewer confirmation.
  if (
    url ===
      "https://www.incometaxindia.gov.in/documents/d/guest/notification-1-2026-pdf" &&
    createHash("sha256").update(text).digest("hex") ===
      "86f7d45576138e329b755cc3a179d0b200a32aa24c5dd1d46a5b77101ead1434"
  ) {
    return {
      label: "Prepare Notification 1/2026 draft",
      description:
        "Fills the entity, multi-period scope and investment deadline. Confirm the Gazette publication/commencement date and current legal status before approval; the instrument is dated 5 January 2026.",
      sectionIds: ["full-document"],
      documentType: "NOTIFICATION",
      legalStatus: "",
      publishedAt: "",
      period: "",
      periodMode: "MULTI_PERIOD",
      effectiveFrom: "",
      effectiveTo: "",
      entityName: "Inbar Holding RSC Limited",
      investmentFrom: "",
      investmentThrough: "2030-03-31",
      applicabilityNote:
        "Entity-specific designation under section 10(23FE) of the Income-tax Act, 1961, subject to the notification's conditions. Eligible investments run from Gazette publication through 31 March 2030 inclusive. Return-filing obligations cover relevant previous years from investment through liquidation. The investment deadline is not an overall expiry. Review applicable transitional or amending provisions for the period of the question.",
      note: "Draft only. Verify the Gazette publication date, commencement and current legal status, including any amendments or transition provisions. The notification itself is dated 5 January 2026. Do not infer a rule expiry from the investment cutoff.",
    };
  }
  if (
    url !==
    "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act"
  )
    return null;
  const section = reviewSections(text).find(
    (section) => section.id === "faq-9",
  );
  // This suggestion was checked against FAQ 9. Any source change removes the
  // preset until it is checked again; suggestions never publish automatically.
  if (
    !section ||
    createHash("sha256").update(section.text).digest("hex") !==
      "ee73d4650161f977e4d3f63fa917031f0458f384660ae8c59c9709d125446275"
  )
    return null;
  return {
    label: "Prepare FAQ 9 review",
    description:
      "Selects FAQ 9 for TY 2026–27, effective 1 April 2026. Check the complete excerpt before publishing.",
    sectionIds: [section.id],
    documentType: "GUIDANCE",
    legalStatus: "GUIDANCE",
    publishedAt: "",
    period: "TY 2026-27",
    effectiveFrom: "2026-04-01",
    effectiveTo: "",
    note: "Scope: FAQ 9 only, explaining the Tax Year concept for TY 2026-27. The passage states that this concept applies from 1 April 2026. This is departmental guidance; the FAQ publication date is not established. No other FAQ answers are included in this approval.",
  };
}
