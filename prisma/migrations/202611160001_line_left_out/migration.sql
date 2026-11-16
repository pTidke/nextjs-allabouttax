-- A fourth line decision, LEFT_OUT: the line is not part of the document's text
-- (a garbled header, a watermark, a stray page number) and stays out of the
-- chatbot's passages. Only the CHECK constraint changes; no data changes.
ALTER TABLE "LineReview" DROP CONSTRAINT "LineReview_decision_check";
ALTER TABLE "LineReview" ADD CONSTRAINT "LineReview_decision_check" CHECK ("decision" IN ('CONFIRMED', 'CORRECTED', 'UNREADABLE', 'LEFT_OUT'));
