import { describe, expect, it } from "vite-plus/test";

import { splitMermaidMarkdown } from "./mermaidMarkdown";

describe("splitMermaidMarkdown", () => {
  it("splits a closed mermaid fence between markdown", () => {
    const markdown = "Here is the flow:\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nDone.";
    expect(splitMermaidMarkdown(markdown)).toEqual([
      { kind: "markdown", markdown: "Here is the flow:\n\n", sourceOffset: 0 },
      {
        kind: "mermaid",
        source: "flowchart TD\n  A --> B\n",
        markdown: "```mermaid\nflowchart TD\n  A --> B\n```",
        sourceOffset: 19,
      },
      { kind: "markdown", markdown: "\nDone.", sourceOffset: 57 },
    ]);
  });

  it("keeps an unclosed streaming fence as markdown", () => {
    const markdown = "Flow:\n```mermaid\nflowchart TD\n  A --> B";
    expect(splitMermaidMarkdown(markdown)).toEqual([
      { kind: "markdown", markdown, sourceOffset: 0 },
    ]);
  });

  it("ignores mermaid fences nested in other fences or indented", () => {
    const markdown =
      "````md\n```mermaid\ngraph LR\n```\n````\n\n- item\n  ```mermaid\n  graph LR\n  ```";
    expect(splitMermaidMarkdown(markdown)).toEqual([
      { kind: "markdown", markdown, sourceOffset: 0 },
    ]);
  });

  it("keeps Mermaid examples inside indented outer fences as code", () => {
    const markdown = "   ````markdown\n```mermaid\ngraph LR\nA --> B\n```\n   ````";
    expect(splitMermaidMarkdown(markdown)).toEqual([
      { kind: "markdown", markdown, sourceOffset: 0 },
    ]);
  });

  it("accepts an indented closing fence", () => {
    const markdown = "```mermaid\ngraph LR\nA --> B\n   ```";
    expect(splitMermaidMarkdown(markdown)[0]?.kind).toBe("mermaid");
  });

  it("splits tilde fences and closes on a longer fence", () => {
    const segments = splitMermaidMarkdown("~~~ Mermaid\ngraph LR\n~~~~\n");
    expect(segments).toEqual([
      {
        kind: "mermaid",
        source: "graph LR\n",
        markdown: "~~~ Mermaid\ngraph LR\n~~~~",
        sourceOffset: 0,
      },
    ]);
  });
});
