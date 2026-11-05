export type ReviewSection = { id: string; title: string; text: string };

// Only split a complete, consecutively numbered FAQ. Other formats retain
// their existing page/passage chunks and require whole-document review.
export function reviewSections(text: string): ReviewSection[] {
  const headings = [...text.matchAll(/^(\d+)\.[ \t]*[^\n]+\?[ \t]*$/gm)];
  if (
    headings.length < 2 ||
    headings.some((heading, index) => Number(heading[1]) !== index + 1)
  )
    return [{ id: "full-document", title: "Entire document", text }];
  return headings.map((heading, index) => ({
    id: `faq-${heading[1]}`,
    title: heading[0].trim(),
    text: text.slice(heading.index, headings[index + 1]?.index).trim(),
  }));
}

export function selectedSections(text: string, ids: string[]) {
  const sections = reviewSections(text);
  if (ids.some((id) => !sections.some((section) => section.id === id)))
    throw new Error(
      "Selected source section is unavailable. Reload the review.",
    );
  return sections.filter((section) => ids.includes(section.id));
}
