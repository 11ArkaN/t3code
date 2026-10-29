type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const FORMATTING_TAGS = new Set(["strong", "em", "del"]);
// Each grapheme of such a run is one punctuation mark plus its combining marks.
const PUNCTUATION_RUN = /^\p{P}[\p{P}\p{M}]*$/u;
const FIRST_MARK = /^\p{P}\p{M}*/u;
const LAST_MARK = /\p{P}\p{M}*$/u;
const LEADING_WORD = /^\S*/u;
const WHITESPACE = /\s/u;

function isChipElement(node: HastNode): boolean {
  return (
    node.tagName === "a" ||
    node.tagName === "img" ||
    (node.tagName === "code" && node.properties?.dataInlineCode != null)
  );
}

function trailingWord(value: string): string {
  let start = value.length;
  while (start > 0 && !WHITESPACE.test(value[start - 1]!)) start--;
  return value.slice(start);
}

// Skill names may contain `_`, `-` and `:`, and the skill matcher treats text
// node edges as token boundaries. A mark moves only when everything between
// the chip and the next space is punctuation, so no skill token is touched.
function touchingPunctuation(node: HastNode | undefined, side: "first" | "last"): string {
  if (node?.type !== "text" || !node.value) return "";
  const run = side === "first" ? LEADING_WORD.exec(node.value)![0] : trailingWord(node.value);
  if (!PUNCTUATION_RUN.test(run)) return "";
  return (side === "first" ? FIRST_MARK : LAST_MARK).exec(run)![0];
}

// Glues inside `node` and returns whether it can render as a chip. Which of
// these become chips is only known at render time; the CSS rule for
// `data-chip-word` applies `nowrap` only to the wrappers that hold one.
function glueChips(node: HastNode): boolean {
  if (isChipElement(node)) return true;
  const children = node.children;
  if (!children || node.tagName === "pre") return false;
  const chips = children.map(glueChips);
  const glued: HastNode[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (!chips[index]) {
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
  node.children = glued;
  return FORMATTING_TAGS.has(node.tagName ?? "") && children.length === 1 && chips[0]!;
}

/**
 * Chips render as atomic inlines, and browsers allow a line break between one
 * and the text touching it, so a period could wrap away from its file chip.
 * Wrapping the chip with the punctuation mark on each side keeps them on one
 * line; text beyond those marks already follows the usual line-breaking rules.
 */
export function rehypeChipWords() {
  return (tree: HastNode) => {
    glueChips(tree);
  };
}
