import { describe, expect, it } from "vite-plus/test";

import { rehypeChipWords } from "./markdownChipWords";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const text = (value: string): Node => ({ type: "text", value });
const element = (tagName: string, children: Node[] = [], properties = {}): Node => ({
  type: "element",
  tagName,
  properties,
  children,
});
const link = element("a", [text("utils.ts")]);

function glued(...children: Node[]) {
  const paragraph = element("p", children);
  rehypeChipWords()({ type: "root", children: [paragraph] });
  return paragraph.children!;
}

function textOf(node: Node): string {
  return node.value ?? (node.children ?? []).map(textOf).join("");
}

describe("rehypeChipWords", () => {
  it("keeps the characters touching a chip with it", () => {
    const children = glued(text("See ("), link, text("). Then"));
    expect(children.map(textOf)).toEqual(["See ", "(utils.ts)", ". Then"]);
    expect(children[1]).toMatchObject({ tagName: "span", properties: { dataChipWord: "" } });
    expect(children[1]!.children![1]).toBe(link);
  });

  it("leaves a chip alone when only spaces touch it", () => {
    const children = glued(text("See "), link, text(" then"));
    expect(children[1]).toBe(link);
  });

  it("drops text nodes it empties", () => {
    const children = glued(link, text("."));
    expect(children).toHaveLength(1);
    expect(children.map(textOf)).toEqual(["utils.ts."]);
  });

  it("moves only punctuation, so letters and symbols keep skill tokens whole", () => {
    expect(glued(text("Run $review"), link).map(textOf)).toEqual(["Run $review", "utils.ts"]);
    expect(glued(link, text("$review now")).map(textOf)).toEqual(["utils.ts", "$review now"]);
    expect(glued(text("x 😀"), link, text("2 y")).map(textOf)).toEqual(["x 😀", "utils.ts", "2 y"]);
    expect(glued(text("«"), link, text("»、")).map(textOf)).toEqual(["«utils.ts»", "、"]);
  });

  it("moves a mark only when the chip's side is punctuation up to the next space", () => {
    expect(glued(link, text("), and")).map(textOf)).toEqual(["utils.ts)", ", and"]);
    expect(glued(link, text(". Did")).map(textOf)).toEqual(["utils.ts.", " Did"]);
    expect(glued(text("x (\u0301"), link).map(textOf)).toEqual(["x ", "(\u0301utils.ts"]);
    for (const [before, after] of [
      ["", ".$review"],
      ["Run $review_", ""],
      ["Run $review.", ""],
      ["", "'s"],
    ]) {
      const children = glued(text(before!), link, text(after!));
      expect(children.map(textOf)).toEqual([before, "utils.ts", after]);
    }
  });

  it("treats inline code and images as chips but not code blocks", () => {
    const code = element("code", [text("a.ts")], { dataInlineCode: "" });
    const image = element("img", [], { src: "t3-context://terminal/1" });
    expect(glued(code, text(",")).map(textOf)).toEqual(["a.ts,"]);
    expect(glued(text("("), image).map(textOf)).toEqual(["("]);
    expect(glued(text("("), image)[0]!.children).toHaveLength(2);
    const block = element("pre", [element("code", [text("a.ts")]), text(".")]);
    glued(block);
    expect(block.children).toHaveLength(2);
    const plainCode = element("code", [text("x")]);
    expect(glued(plainCode, text("."))[0]).toBe(plainCode);
  });

  it("glues chips inside nested inline elements", () => {
    const strong = element("strong", [link, text(":")]);
    glued(strong);
    expect(strong.children!.map(textOf)).toEqual(["utils.ts:"]);
  });

  it("glues a formatting element that holds only a chip", () => {
    const bold = element("strong", [link]);
    expect(glued(bold, text("."))).toMatchObject([{ properties: { dataChipWord: "" } }]);
    expect(glued(bold, text("."))[0]!.children![0]).toBe(bold);
    const code = element("code", [text("src/foo.ts")], { dataInlineCode: "" });
    const nested = element("em", [element("strong", [code])]);
    expect(glued(text("- "), nested, text(": description")).map(textOf)).toEqual([
      "- ",
      "src/foo.ts:",
      " description",
    ]);
    const mixed = element("strong", [text("see "), link]);
    expect(glued(mixed, text("."))[0]).toBe(mixed);
    const separate = element("strong", [text(".")]);
    expect(glued(link, separate)[0]).toBe(link);
  });

  it("shares a character between adjacent chips with the first one", () => {
    const other = element("a", [text("b.ts")]);
    const children = glued(link, text("/"), other);
    expect(children.map(textOf)).toEqual(["utils.ts/", "b.ts"]);
  });
});
