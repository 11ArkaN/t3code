import type { Nodes } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";

const parser = unified().use(remarkParse);

export type MermaidMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | {
      readonly kind: "mermaid";
      readonly source: string;
      readonly markdown: string;
      readonly sourceOffset: number;
    };

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/s;

/**
 * Splits closed, unindented mermaid fences out of markdown. Unclosed fences stay
 * markdown so a streaming diagram shows as code until its closing fence arrives.
 */
export function splitMermaidMarkdown(markdown: string): ReadonlyArray<MermaidMarkdownSegment> {
  if (!/mermaid/i.test(markdown)) return [{ kind: "markdown", markdown, sourceOffset: 0 }];

  const document = parser.parse(markdown);
  const codeOffsets = new Set(
    document.children
      .filter((node) => node.type === "code" && node.lang?.toLowerCase() === "mermaid")
      .map((node) => node.position?.start.offset),
  );
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
        if (open.mermaid && codeOffsets.has(open.start)) {
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
  const definitions = new Map<string, string>();
  const references: { offset: number; identifier: string }[] = [];
  const pending: Nodes[] = [document];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === "definition" && start !== undefined && end !== undefined) {
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, markdown.slice(start, end));
      }
    } else if (
      (node.type === "linkReference" || node.type === "imageReference") &&
      start !== undefined
    ) {
      references.push({ offset: start, identifier: node.identifier });
    } else if ("children" in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child) pending.push(child);
      }
    }
  }
  if (references.length === 0) return segments;
  let referenceIndex = 0;
  // Native views parse independently, so carry each fragment's reference definitions with it.
  return segments.map((segment) => {
    const needed = new Set<string>();
    const end = segment.sourceOffset + segment.markdown.length;
    while (referenceIndex < references.length) {
      const reference = references[referenceIndex];
      if (!reference || reference.offset >= end) break;
      if (reference.offset >= segment.sourceOffset) needed.add(reference.identifier);
      referenceIndex++;
    }
    const prefix = [...needed]
      .map((identifier) => definitions.get(identifier))
      .filter(Boolean)
      .join("\n");
    return prefix ? { ...segment, markdown: `${prefix}\n\n${segment.markdown}` } : segment;
  });
}
