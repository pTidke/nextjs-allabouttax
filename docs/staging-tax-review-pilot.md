# Staging tax review pilot

Visit **Tax review** at /staging/tax-review with the Google account approved by the operator. Open the official PDF when you need the full context. Fill in the instrument and legal status, who and what it applies to, applicable periods and dates, and your decision notes. For acceptance, mark one or more supporting lines. Save a draft if you need to come back; use **Request changes** if anything must be fixed first.

The inbox only shows full-page extraction scopes with a current acceptance. Each decision is bound to the accepted extraction revision and the signed-in reviewer. Staging extraction reviewers can view the pilot; only an active tax reviewer can save a decision. Partial table scopes stay in extraction. This pilot has no link to public chat or publication.

On an existing staging instance, apply tools/extraction-staging/tax-review.sql as the operator in the isolated review database before deploying this screen. Grant the web role SELECT on extraction_staging.tax_reviewers and SELECT, INSERT on extraction_staging.tax_reviews. Do not give the web role write access to reviewer grants. Record the approved email in lowercase with a reason and explicit expiry. Set revoked_at to revoke. An email grant comes into effect on a verified Google sign-in; Vercel preview access is a separate requirement.
