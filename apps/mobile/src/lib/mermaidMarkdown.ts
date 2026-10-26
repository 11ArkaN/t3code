export type MermaidMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | {
      readonly kind: "mermaid";
      readonly source: string;
      readonly markdown: string;
      readonly sourceOffset: number;
    };

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Splits closed, unindented mermaid fences out of markdown. Unclosed fences stay
 * markdown so a streaming diagram shows as code until its closing fence arrives.
 */
export function splitMermaidMarkdown(markdown: string): ReadonlyArray<MermaidMarkdownSegment> {
  if (!/mermaid/i.test(markdown)) return [{ kind: "markdown", markdown, sourceOffset: 0 }];

  const segments: MermaidMarkdownSegment[] = [];
  let cursor = 0;
  let open: { fence: string; start: number; bodyStart: number; mermaid: boolean } | null = null;
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const next = newline === -1 ? markdown.length : newline + 1;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const match = FENCE_PATTERN.exec(line);
    if (match) {
      const [, fence = "", info = ""] = match;
      if (open === null) {
        // Backtick fences cannot have backticks in their info string.
        if (!(fence[0] === "`" && info.includes("`"))) {
          open = {
            fence,
            start: lineStart,
            bodyStart: next,
            mermaid: line[0] !== " " && info.trim().split(/\s/, 1)[0]?.toLowerCase() === "mermaid",
          };
        }
      } else if (
        fence[0] === open.fence[0] &&
        fence.length >= open.fence.length &&
        info.trim() === ""
      ) {
        if (open.mermaid) {
          const source = markdown.slice(open.bodyStart, lineStart);
          if (source.trim().length > 0) {
            if (open.start > cursor) {
              segments.push({
                kind: "markdown",
                markdown: markdown.slice(cursor, open.start),
                sourceOffset: cursor,
              });
            }
            segments.push({
              kind: "mermaid",
              source,
              markdown: markdown.slice(open.start, lineEnd),
              sourceOffset: open.start,
            });
            cursor = next;
          }
        }
        open = null;
      }
    }
    lineStart = next;
  }
  if (segments.length === 0) return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor), sourceOffset: cursor });
  }
  return segments;
}
