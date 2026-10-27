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

const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Splits closed, unindented mermaid fences out of markdown. Unclosed fences stay
 * markdown so a streaming diagram shows as code until its closing fence arrives.
 */
export function splitMermaidMarkdown(markdown: string): ReadonlyArray<MermaidMarkdownSegment> {
  if (!/mermaid/i.test(markdown)) return [{ kind: "markdown", markdown, sourceOffset: 0 }];

  const document = parser.parse(markdown);
  const segments: MermaidMarkdownSegment[] = [];
  let cursor = 0;
  for (const node of document.children) {
    if (node.type !== "code" || node.lang?.toLowerCase() !== "mermaid") continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (start > 0 && markdown[start - 1] !== "\n") continue;
    const block = markdown.slice(start, end);
    const bodyStart = block.indexOf("\n") + 1;
    const closeStart = block.lastIndexOf("\n") + 1;
    // An unclosed fence runs to the end of the document, so its last line is not a valid close.
    const close = CLOSING_FENCE_PATTERN.exec(block.slice(closeStart))?.[1] ?? "";
    const opener = /^(`+|~+)/.exec(block)?.[1] ?? "";
    if (bodyStart === 0 || close[0] !== opener[0] || close.length < opener.length) continue;
    const source = block.slice(bodyStart, closeStart);
    if (source.trim().length === 0) continue;
    if (start > cursor) {
      segments.push({
        kind: "markdown",
        markdown: markdown.slice(cursor, start),
        sourceOffset: cursor,
      });
    }
    segments.push({ kind: "mermaid", source, markdown: block, sourceOffset: start });
    cursor = markdown.startsWith("\r\n", end) ? end + 2 : markdown[end] === "\n" ? end + 1 : end;
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
    }
    if ("children" in node) {
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
