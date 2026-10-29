type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const FORMATTING_TAGS = new Set(["strong", "em", "del"]);
const PUNCTUATION = /^\p{P}/u;

// Which of these become chips is only known at render time; the CSS rule for
// `data-chip-word` applies `nowrap` only to the wrappers that hold one.
function canRenderAsChip(node: HastNode): boolean {
  if (FORMATTING_TAGS.has(node.tagName ?? "")) {
    return node.children?.length === 1 && canRenderAsChip(node.children[0]!);
  }
  return (
    node.tagName === "a" ||
    node.tagName === "img" ||
    (node.tagName === "code" && node.properties?.dataInlineCode != null)
  );
}

// Only punctuation moves: letters or `$` would split skill tokens matched later.
function touchingPunctuation(node: HastNode | undefined, side: "first" | "last"): string {
  if (node?.type !== "text" || !node.value) return "";
  const at = side === "first" ? 0 : node.value.length - 1;
  const grapheme = graphemes.segment(node.value).containing(at)?.segment ?? "";
  return PUNCTUATION.test(grapheme) ? grapheme : "";
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
    const leading = touchingPunctuation(before, "last");
    const trailing = touchingPunctuation(after, "first");
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
 * Wrapping the chip with the punctuation mark on each side keeps them on one
 * line; text beyond those marks already follows the usual line-breaking rules.
 */
export function rehypeChipWords() {
  return (tree: HastNode) => glueChips(tree);
}
