import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";
import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ observeSource: vi.fn(), dispose: vi.fn() }));
vi.mock(import("./AssistantCitationSource"), async (importOriginal) => ({
  ...(await importOriginal()),
  observeAssistantCitationCommentSource: mocks.observeSource,
}));
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
  Link: (({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  )) as never,
}));

import { AssistantCitationChip } from "./AssistantCitationChip";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("source"),
  text: "hello",
  start: 0,
  end: 5,
  prefix: "",
  suffix: "",
};

// The mocked source observer is shared, so every test starts by resetting it.
function setup() {
  mocks.observeSource.mockReset().mockReturnValue(mocks.dispose);
  mocks.dispose.mockClear();
  const source = document.createElement("p");
  source.textContent = "hello";
  document.body.append(source);
  const range = document.createRange();
  range.selectNodeContents(source);
  const sourceAnchor = { source, range, viewport: document.body } as AssistantCitationSourceAnchor;
  return { sourceAnchor, [Symbol.dispose]: () => source.remove() };
}

function mount(sourceAnchor: AssistantCitationSourceAnchor, onSave: () => boolean) {
  function Composer() {
    const [open, setOpen] = useState(true);
    return (
      <AssistantCitationChip
        citation={citation}
        composer
        commentEditor={{ open, sourceAnchor, onOpenChange: setOpen, onSave }}
      />
    );
  }
  return render(<Composer />);
}

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment on selected text"]');

async function typeComment(value: string) {
  const input = textarea()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function removeSource() {
  const { onUnavailable } = mocks.observeSource.mock.lastCall![0];
  await act(async () => onUnavailable());
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

describe("composer quote hit area", () => {
  it("hits the quote link and pencil outside their painted boxes without growing the line", async () => {
    const onOpenChange = vi.fn();
    await using screen = await render(
      <p className="mt-8 w-[60ch] text-sm leading-relaxed">
        <span data-neighbor="before">Before</span>{" "}
        <AssistantCitationChip
          citation={citation}
          composer
          commentEditor={{ open: false, onOpenChange, onSave: () => true }}
        />{" "}
        <span data-neighbor="after">after</span>
      </p>,
    );
    const paragraph = screen.container.querySelector("p")!;
    const link = screen.container.querySelector("a")!;
    const action = screen.container.querySelector<HTMLElement>("[data-citation-comment-trigger]")!;
    const label = screen.container.querySelector<HTMLElement>('[data-slot="context-chip-label"]')!;
    const em = Number.parseFloat(getComputedStyle(action).fontSize);
    const box = (element: Element) => element.getBoundingClientRect();
    const hits = (element: Element, x: number, y: number) => {
      const found = document.elementFromPoint(x, y);
      return found !== null && (found === element || element.contains(found));
    };

    const actionBox = box(action);
    const linkBox = box(link);
    const labelBox = box(label);
    expect(actionBox.width).toBeCloseTo(em, 0);
    expect(actionBox.height).toBeCloseTo(em, 0);
    expect(linkBox.height).toBeCloseTo(labelBox.height, 0);
    expect(box(paragraph).height).toBeCloseTo(
      Number.parseFloat(getComputedStyle(paragraph).lineHeight),
      0,
    );

    const actionCenter = {
      x: actionBox.left + actionBox.width / 2,
      y: actionBox.top + em / 2,
    };
    const labelCenter = {
      x: labelBox.left + labelBox.width / 2,
      y: labelBox.top + labelBox.height / 2,
    };
    expect(hits(action, actionCenter.x, actionCenter.y)).toBe(true);
    expect(hits(link, labelCenter.x, labelCenter.y)).toBe(true);
    expect(hits(action, labelCenter.x, labelCenter.y)).toBe(false);
    const pencilSlop = document.elementFromPoint(actionCenter.x, actionBox.top - em * 0.3);
    expect(pencilSlop).toBe(action);
    expect(document.elementFromPoint(actionCenter.x, actionBox.top - em * 0.8)).not.toBe(action);
    expect(document.elementFromPoint(labelCenter.x, linkBox.top - em * 0.3)).toBe(link);
    expect(document.elementFromPoint(labelCenter.x, linkBox.top - em * 0.8)).not.toBe(link);
    expect(document.elementFromPoint(actionBox.left - em * 0.2, actionCenter.y)).toBe(action);
    expect(getComputedStyle(action, "::after").position).toBe("absolute");
    expect(getComputedStyle(action, "::after").backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(link, "::after").position).toBe("absolute");
    expect(getComputedStyle(link, "::after").backgroundColor).toBe("rgba(0, 0, 0, 0)");

    const before = box(screen.container.querySelector('[data-neighbor="before"]')!);
    const after = box(screen.container.querySelector('[data-neighbor="after"]')!);
    expect(hits(action, before.left + before.width / 2, before.top + before.height / 2)).toBe(
      false,
    );
    expect(hits(link, before.left + before.width / 2, before.top + before.height / 2)).toBe(false);
    expect(hits(action, after.left + after.width / 2, after.top + after.height / 2)).toBe(false);
    expect(hits(link, after.left + after.width / 2, after.top + after.height / 2)).toBe(false);
    expect(document.elementFromPoint(actionBox.right + em * 0.2, actionCenter.y)).toBe(action);

    await userEvent.click(pencilSlop!);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

describe("citation comment source disappearance", () => {
  it("preserves an over-length draft at the composer until it can be shortened and saved", async () => {
    using source = setup();
    const onSave = vi.fn(() => true);
    await using _screen = await mount(source.sourceAnchor, onSave);
    const draft = "x".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1);
    await typeComment(draft);
    await removeSource();

    expect(textarea()?.value).toBe(draft);
    expect(textarea()?.getAttribute("aria-invalid")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
    expect(mocks.observeSource).toHaveBeenCalledTimes(1);

    await typeComment("shortened comment");
    await clickButton("Save");
    expect(onSave).toHaveBeenCalledWith("shortened comment");
    expect(textarea()).toBeNull();
  });

  it("preserves a rejected save and allows a later retry", async () => {
    using source = setup();
    const onSave = vi.fn(() => false);
    await using _screen = await mount(source.sourceAnchor, onSave);
    await typeComment("keep this draft");
    await removeSource();

    expect(onSave).toHaveBeenCalledWith("keep this draft");
    expect(textarea()?.value).toBe("keep this draft");
    onSave.mockReturnValue(true);
    await clickButton("Save");
    expect(onSave).toHaveBeenLastCalledWith("keep this draft");
    expect(textarea()).toBeNull();
  });
});

describe("citation comment popup position", () => {
  it("stays on screen when the cited text ends in a code block's hidden overflow", async () => {
    using _source = setup();
    const message = document.createElement("div");
    message.className = "chat-markdown";
    message.style.width = "240px";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    // Highlighted code is split into token spans, so the range's last client rect
    // covers only the final token, wholly inside the hidden overflow.
    for (let index = 0; index < 40; index += 1) {
      const token = document.createElement("span");
      token.textContent = `token${index} `;
      code.append(token);
    }
    pre.append(code);
    message.append(pre);
    document.body.prepend(message);
    using _message = { [Symbol.dispose]: () => message.remove() };
    const range = document.createRange();
    range.selectNodeContents(code);
    const rects = range.getClientRects();
    expect(rects.item(rects.length - 1)!.left).toBeGreaterThan(window.innerWidth);
    const sourceAnchor = {
      source: message,
      range,
      viewport: document.body,
    } as AssistantCitationSourceAnchor;

    await using _screen = await mount(
      sourceAnchor,
      vi.fn(() => true),
    );
    const popup = () => document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
    await vi.waitFor(() => expect(popup()?.getBoundingClientRect().width).toBeGreaterThan(0));
    // Typing scrolls ancestors to reveal the caret, which shifts the whole app
    // sideways when the box is off screen.
    await userEvent.keyboard("note");

    expect(textarea()?.value).toBe("note");
    expect(document.scrollingElement?.scrollLeft).toBe(0);
    expect(document.body.scrollLeft).toBe(0);
    const rect = popup()!.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  });
});
