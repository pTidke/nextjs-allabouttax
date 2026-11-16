import type { EngineDocument, EngineLine } from "./extraction-runs";
import { mostlyDevanagari } from "./line-rules";
import { closingLines } from "./closing-lines";
import { incomeYears } from "../tax/years";

// From reviewed lines to the chatbot's chunks, in two steps, both by rule
// (AD-49). Database-free, so it can be tested and re-run on any reviewed run.
//
// 1. The reviewed document (`reviewedDocument`): the run's lines with the
//    reviewers' corrections, without Hindi evidence, the signature and "Copy
//    to" list, or lines left out by hand; joined into blocks (paragraphs,
//    tables, headings). A paragraph the engine broke in two, or one that runs
//    onto the next page, is joined again, and a word hyphenated across a line
//    break is closed up. This is what "Behind the scenes" shows as the whole
//    document.
// 2. Chunks (`chunksFrom`): blocks packed in order under one heading path, up
//    to 2,000 characters, never cutting a block, a sentence or a word. A
//    proviso or Explanation stays with its paragraph; a new numbered paragraph
//    starts a new chunk once the current one has some substance. A block too
//    long for one chunk is split between sentences, and each piece after the
//    first repeats the sentence before it, so nothing depends on a cut.
//
// Each chunk carries its metadata: first and last page, heading path, a
// context line ("Annexure A › para 2"), kind, the income years and the
// provisions it names.

export const MAX_CHUNK_CHARS = 2000;
// A numbered paragraph starts a new chunk once the current one is this long.
const NEW_PARAGRAPH_AFTER = 400;
// A sentence repeated at the start of the next piece of a long paragraph.
const MAX_OVERLAP_CHARS = 300;

export type Decided = { decision: string; text: string | null };

export type Block = {
  kind: "heading" | "text" | "table";
  text: string;
  page: number;
  pageEnd: number;
};

export type Chunk = {
  anchor: string;
  text: string;
  page: number;
  pageEnd: number;
  headings: string[];
  context: string;
  kind: "text" | "proviso" | "explanation" | "table" | "heading";
  incomeYears: string[];
  provisions: string[];
};

// A sentence or clause has ended.
const ENDED = /[.:;?!]["'”’)\]]*$/;
// The start of a numbered paragraph, sub-paragraph or clause: "2.", "(3)",
// "(a)", "(iv)", "3A.".
const NUMBERED =
  /^(?:\d+[A-Z]?\.\s|\(\s*(?:\d+[A-Z]?|[a-z]{1,2}|[ivxlc]+)\s*\)\s)/;
const TOP_LEVEL = /^(\d+[A-Z]?)\.\s/;
// Words that cannot end a sentence or a clause.
const OPEN_WORD =
  /\b(?:and|or|of|the|a|an|to|in|by|for|with|under|on|at|from|as|that|which|is|are|be|shall|may|its|their|this|such|any|said)$/i;

// Two lines of one paragraph: a word hyphenated across the break is closed up
// ("Income-" + "tax" gives "Income-tax", "10-" + "IG" gives "10-IG"; the hyphen
// is kept, since most hyphens in tax text are real); otherwise a space.
function joinLines(parts: string[]) {
  let out = "";
  for (const part of parts) {
    if (!out) out = part;
    else if (/[A-Za-z0-9]-$/.test(out) && /^[A-Za-z0-9]/.test(part))
      out += part;
    else out += ` ${part}`;
  }
  return out;
}

// The second block carries on the first: the first has not ended, and the
// second does not start anything new (a heading or a numbered item). On one
// page the engine's paragraph break is trusted unless the signs are clear (the
// second starts in lower case, or the first stops on a comma or a word that
// cannot end a clause); across a page break any unfinished paragraph carries
// on, since a page ends wherever it ends.
// A title in capitals ("MINISTRY OF FINANCE", "SCHEDULE II") is not an
// unfinished sentence, even without a full stop.
const title = (text: string) =>
  /[A-Z]{3}/.test(text) && text === text.toUpperCase();

function continues(first: Block, second: Block) {
  if (first.kind !== "text" || second.kind !== "text") return false;
  if (NUMBERED.test(second.text) || ENDED.test(first.text)) return false;
  if (title(first.text) || title(second.text)) return false;
  if (second.page > first.pageEnd) return true;
  return (
    /^[a-z]/.test(second.text) ||
    /[,(-]$/.test(first.text) ||
    OPEN_WORD.test(first.text)
  );
}

export function reviewedDocument(
  document: EngineDocument,
  decisions: Map<string, Decided>,
): Block[] {
  const closing = closingLines(document);
  const blocks: Block[] = [];
  for (const page of document.pages) {
    let unit: { key: string; parts: string[]; kind: Block["kind"] } | null =
      null;
    const flush = () => {
      if (!unit) return;
      const text =
        unit.kind === "table" ? unit.parts.join("\n") : joinLines(unit.parts);
      const block: Block = {
        kind: unit.kind,
        text,
        page: page.number,
        pageEnd: page.number,
      };
      const last = blocks[blocks.length - 1];
      if (last && continues(last, block)) {
        last.text = joinLines([last.text, block.text]);
        last.pageEnd = page.number;
      } else blocks.push(block);
      unit = null;
    };
    for (const line of page.lines as EngineLine[]) {
      if (line.excluded || closing.has(line.id)) continue;
      const decided = decisions.get(line.id);
      if (decided?.decision === "LEFT_OUT") continue;
      const text = (
        decided?.decision === "CORRECTED" && decided.text
          ? decided.text
          : line.text
      ).trim();
      // Hindi stays evidence only: wholly Devanagari lines are excluded by the
      // engine, mostly Devanagari ones (a Gazette header) here.
      if (!text || mostlyDevanagari(text)) continue;
      const key = line.table_id ? `t:${line.table_id}` : `p:${line.paragraph}`;
      if (!unit || unit.key !== key) {
        flush();
        unit = {
          key,
          parts: [],
          kind: line.table_id
            ? "table"
            : line.role === "heading"
              ? "heading"
              : "text",
        };
      }
      unit.parts.push(text);
    }
    flush();
  }
  return blocks;
}

// The document as one text, page by page, for reading it whole.
export function documentText(blocks: Block[]) {
  return blocks.map((block) => block.text).join("\n\n");
}

const ABBREVIATION =
  /\b(?:No|Nos|S\.O|G\.S\.R|Rs|Sr|Mr|Mrs|Ms|Dr|M\/s|viz|i\.e|e\.g|etc|vs|Co|Ltd|Pvt|Govt|Dept|Sec|Cl|Para|Ch|Art|Vol|w\.e\.f|u\/s|Sub|[A-Z])\.$/;

// A long text in sentences: a sentence ends at . ? ! ; or : followed by a space
// and a capital, a digit, an opening bracket or quote, unless the word before
// it is an abbreviation ("No. 1/2026", "S.O. 44(E)", "M/s. ABC").
export function sentences(text: string) {
  const out: string[] = [];
  let start = 0;
  const boundary = /[.?!;:]["'”’)\]]*(\s+)(?=[A-Z0-9("'“‘[])/g;
  for (const m of text.matchAll(boundary)) {
    const end = m.index! + m[0].length - m[1].length;
    const candidate = text.slice(start, end);
    if (ABBREVIATION.test(candidate)) continue;
    out.push(candidate.trim());
    start = end + m[1].length;
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

// A sentence longer than a chunk (a table row run together, a list without
// stops) is cut at the last comma or space before the limit: never in a word.
function hardSplit(text: string, max: number) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at =
      Math.max(window.lastIndexOf(", "), window.lastIndexOf("; ")) + 1 ||
      window.lastIndexOf(" ");
    const cut = at > max / 2 ? at : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// One block too long for a chunk, in pieces of whole sentences. Each piece
// after the first begins with the sentence before it, when that is short.
export function splitLong(text: string, max = MAX_CHUNK_CHARS) {
  const parts = sentences(text).flatMap((s) =>
    s.length > max ? hardSplit(s, max) : [s],
  );
  const pieces: string[] = [];
  let current: string[] = [];
  const length = (list: string[]) => list.join(" ").length;
  for (const part of parts) {
    if (current.length && length([...current, part]) > max) {
      pieces.push(current.join(" "));
      const last = current[current.length - 1];
      current =
        last.length <= MAX_OVERLAP_CHARS && length([last, part]) <= max
          ? [last]
          : [];
    }
    current.push(part);
  }
  if (current.length) pieces.push(current.join(" "));
  return pieces;
}

const PROVISION =
  /\b(section|sub-section|clause|rule|sub-rule|form|schedule|chapter|article)s?\s+(?:no\.?\s*)?(\d+[A-Z]{0,3}(?:-[A-Z0-9]+)?(?:\s?\([0-9A-Za-z]{1,6}\))*)/gi;

// The provisions a text names: "section 10(23FE)", "rule 34", "Form 10-IG".
export function provisionsIn(text: string) {
  const found = new Set<string>();
  for (const m of text.matchAll(PROVISION)) {
    const word = m[1].toLowerCase();
    const name = word === "form" ? "Form" : word;
    found.add(`${name} ${m[2].replace(/\s+/g, "")}`);
  }
  return [...found];
}

const kindOf = (blocks: Block[]): Chunk["kind"] => {
  const first = blocks.find((block) => block.kind !== "heading");
  if (!first) return "heading";
  if (first.kind === "table") return "table";
  if (/^(?:\(\w+\)\s*)?provided\b/i.test(first.text)) return "proviso";
  if (/^explanation\b/i.test(first.text)) return "explanation";
  return "text";
};

export function chunksFrom(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let header: string | null = null;
  let current: string | null = null;
  let paragraph: string | null = null;
  // The chunk being filled.
  let parts: Block[] = [];
  let path: string[] = [];
  let label: string | null = null;
  let continued = false;

  const size = () => parts.reduce((n, b) => n + b.text.length + 2, 0);
  const flush = () => {
    if (!parts.length) return;
    const text = parts.map((b) => b.text).join("\n\n");
    const page = parts[0].page;
    // The chunk's paragraph: the first numbered one in it, else the one it
    // continues.
    const first = parts
      .map((b) => (b.kind === "text" ? b.text.match(TOP_LEVEL)?.[1] : null))
      .find(Boolean);
    if (first && !continued) label = first;
    const context = [
      ...path,
      label ? `para ${label}${continued ? " (continued)" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" › ");
    chunks.push({
      anchor: `Page ${page}, passage ${chunks.filter((c) => c.page === page).length + 1}`,
      text,
      page,
      pageEnd: Math.max(...parts.map((b) => b.pageEnd)),
      headings: path,
      context,
      kind: kindOf(parts),
      incomeYears: incomeYears(`${path.join("\n")}\n${text}`),
      provisions: provisionsIn(text),
    });
    parts = [];
    continued = false;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // A run of headings is one heading: the document's opening heading block,
    // then the latest section heading (a schedule, chapter, annexure...).
    if (block.kind === "heading" && blocks[i - 1]?.kind !== "heading") {
      let text = block.text;
      for (
        let j = i + 1;
        j < blocks.length && blocks[j].kind === "heading";
        j++
      )
        text = `${text} ${blocks[j].text}`;
      if (header === null) header = text;
      else {
        current = text;
        paragraph = null;
      }
    }
    const top = block.kind === "text" ? block.text.match(TOP_LEVEL)?.[1] : null;
    if (top) paragraph = top;
    const nextPath = [header, current].filter((h): h is string => !!h);
    if (
      parts.length &&
      (nextPath.join("\n") !== path.join("\n") ||
        (top && size() >= NEW_PARAGRAPH_AFTER) ||
        size() + block.text.length > MAX_CHUNK_CHARS)
    )
      flush();
    if (!parts.length) {
      path = nextPath;
      label = paragraph;
    }
    if (block.text.length <= MAX_CHUNK_CHARS) {
      parts.push(block);
      continue;
    }
    // Too long for one chunk: whole sentences, each piece its own chunk.
    const pieces = splitLong(block.text);
    pieces.forEach((piece, n) => {
      if (n) {
        flush();
        path = nextPath;
        label = paragraph;
        continued = true;
      }
      parts.push({ ...block, text: piece });
    });
  }
  flush();
  return chunks;
}
