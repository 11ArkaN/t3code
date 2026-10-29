type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Which of these become chips is only known at render time; the CSS rule for
// `data-chip-word` applies `nowrap` only to the wrappers that hold one.
function canRenderAsChip(node: HastNode): boolean {
  return (
    node.tagName === "a" ||
    node.tagName === "img" ||
    (node.tagName === "code" && node.properties?.dataInlineCode != null)
  );
}

function touchingGrapheme(node: HastNode | undefined, side: "first" | "last"): string {
  if (node?.type !== "text" || !node.value) return "";
  const at = side === "first" ? 0 : node.value.length - 1;
  const grapheme = graphemes.segment(node.value).containing(at)?.segment ?? "";
  return /\s/.test(grapheme) ? "" : grapheme;
}

function glueChips(parent: HastNode): void {
  const children = parent.children;
  if (!children || parent.tagName === "pre") return;
  const glued: HastNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (!canRenderAsChip(child)) {
      glueChips(child);
      glued.push(child);
      continue;
    }
    const before = glued.at(-1);
    const after = children[index + 1];
    const leading = touchingGrapheme(before, "last");
    const trailing = touchingGrapheme(after, "first");
    if (!leading && !trailing) {
      glued.push(child);
      continue;
    }
    const word: HastNode[] = [child];
    if (before && leading) {
      before.value = before.value!.slice(0, -leading.length);
      if (!before.value) glued.pop();
      word.unshift({ type: "text", value: leading });
    }
    if (after && trailing) {
      after.value = after.value!.slice(trailing.length);
      if (!after.value) index++;
      word.push({ type: "text", value: trailing });
    }
    glued.push({
      type: "element",
      tagName: "span",
      properties: { dataChipWord: "" },
      children: word,
    });
  }
  parent.children = glued;
}

/**
 * Chips render as atomic inlines, and browsers allow a line break between one
 * and the text touching it, so a period could wrap away from its file chip.
 * Wrapping the chip with the character on each side keeps them on one line;
 * text beyond those characters already follows the usual line-breaking rules.
 */
export function rehypeChipWords() {
  return (tree: HastNode) => glueChips(tree);
}
