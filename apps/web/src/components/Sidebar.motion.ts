const motionTiming = { duration: 150, easing: "ease-out" };
const rowTravel = (height: number) => Math.min(height, 40);
// Fades clone removed rows and animate clones and entries; intervening layout reads force reflows.
const MAX_FADED_ROWS_PER_UPDATE = 40;

type RowPosition = { top: number; left: number; width: number; height: number };
type Edge = { from: number; to: number };
type Frame = { opacity: number; y: number };

/** Clip a travelling row to the space between its neighbours' edges so it never paints over them. */
function clippedKeyframes(
  top: number,
  height: number,
  from: Frame,
  to: Frame,
  above: Edge | undefined,
  below: Edge | undefined,
): Keyframe[] {
  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  // Neighbours move with the same timing, so each overlap is linear in eased progress.
  const overlaps = [
    above && ((p: number) => lerp(above.from, above.to, p) - top - lerp(from.y, to.y, p)),
    below && ((p: number) => top + lerp(from.y, to.y, p) + height - lerp(below.from, below.to, p)),
  ];
  const offsets = [0, 1];
  for (const overlap of overlaps) {
    if (!overlap) continue;
    const start = overlap(0);
    const end = overlap(1);
    const crossing = start / (start - end);
    if (crossing > 0 && crossing < 1) offsets.push(crossing);
  }
  offsets.sort((a, b) => a - b);
  const clips = (p: number) => overlaps.map((overlap) => Math.max(0, overlap?.(p) ?? 0));
  const clipped = offsets.some((p) => clips(p).some((clip) => clip > 0));
  return offsets.map((offset) => {
    const [clipTop, clipBottom] = clips(offset);
    return {
      offset,
      opacity: lerp(from.opacity, to.opacity, offset),
      transform: `translateY(${lerp(from.y, to.y, offset)}px)`,
      ...(clipped ? { clipPath: `inset(${clipTop}px 0 ${clipBottom}px)` } : {}),
    };
  });
}

function progress(animation: Animation) {
  return animation.playState === "finished"
    ? 1
    : (animation.effect?.getComputedTiming().progress ?? 0);
}

/** Position the list so all direct children's offsetTop share an origin. */
export function createSidebarListMotion(parent: HTMLUListElement) {
  let positions: Map<HTMLElement, RowPosition> | null = null;
  let disposed = false;
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const running = new Map<HTMLElement, { animation: Animation; offset: number }>();
  const entering = new Map<HTMLElement, { animation: Animation; travel: number }>();
  const exiting = new Map<HTMLElement, Animation>();
  let released: Map<HTMLElement, number> | null = null;

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node);
    const run = current ? current.offset * (1 - progress(current.animation)) : 0;
    const entry = entering.get(node);
    const enter = entry ? entry.travel * (1 - progress(entry.animation)) : 0;
    return run + enter;
  };
  const clearFades = () => {
    for (const entry of entering.values()) entry.animation.cancel();
    for (const animation of exiting.values()) animation.cancel();
    for (const node of exiting.keys()) node.remove();
    entering.clear();
    exiting.clear();
  };
  const fadeOut = (
    node: HTMLElement,
    position: RowPosition,
    travel: number,
    above: Edge | undefined,
    below: Edge | undefined,
  ) => {
    if (position.height === 0) return;
    const clone = node.cloneNode(true) as HTMLElement;
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (
          (attribute.name === "id" && element.namespaceURI !== "http://www.w3.org/2000/svg") ||
          attribute.name === "data-thread-item" ||
          attribute.name === "data-thread-selection-safe" ||
          attribute.name === "data-testid"
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    const top = position.top + remainingOffset(node);
    Object.assign(clone.style, {
      position: "absolute",
      top: `${top}px`,
      left: `${position.left}px`,
      width: `${position.width}px`,
      height: `${position.height}px`,
      margin: "0",
      boxSizing: "border-box",
      contentVisibility: "visible",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    });
    parent.append(clone);
    const entry = entering.get(node);
    const entryProgress = entry ? progress(entry.animation) : 1;
    const animation = clone.animate(
      clippedKeyframes(
        top,
        position.height,
        { opacity: entryProgress, y: 0 },
        { opacity: 0, y: travel },
        above,
        below,
      ),
      motionTiming,
    );
    exiting.set(clone, animation);
    animation.addEventListener(
      "finish",
      () => {
        clone.remove();
        exiting.delete(clone);
      },
      { once: true },
    );
  };

  const cancel = (node: HTMLElement) => {
    running.get(node)?.animation.cancel();
    running.delete(node);
  };
  const suspend = () => {
    for (const node of running.keys()) cancel(node);
    clearFades();
    positions = null;
    released = null;
  };
  const move = (node: HTMLElement, offset: number) => {
    cancel(node);
    const entry = entering.get(node);
    if (entry) entry.travel = 0;
    if (offset === 0 && !entry) return;
    const animation = node.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
      motionTiming,
    );
    running.set(node, { animation, offset });
    animation.addEventListener(
      "finish",
      () => {
        if (running.get(node)?.animation === animation) running.delete(node);
      },
      { once: true },
    );
  };

  return {
    update(animate: boolean) {
      if (disposed) return;
      const next = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [
            node,
            {
              top: node.offsetTop,
              left: node.offsetLeft,
              width: node.offsetWidth,
              height: node.offsetHeight,
            },
          ]),
      );
      let fadeCount = 0;
      if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node) && position.height > 0) fadeCount++;
        }
        for (const [node, position] of next) {
          if (!positions.has(node) && position.height > 0) fadeCount++;
        }
      }
      const shouldAnimate =
        animate &&
        positions !== null &&
        !reducedMotion?.matches &&
        fadeCount <= MAX_FADED_ROWS_PER_UPDATE;
      const movedDelta = new Map<HTMLElement, number>();
      const nextOrder = [...next.keys()];
      const oldOrder = positions === null ? [] : [...positions.keys()];
      const ridingDelta = (
        order: readonly HTMLElement[],
        index: number,
        retained: (node: HTMLElement) => boolean,
      ) => {
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          const node = order[cursor]!;
          const delta = movedDelta.get(node);
          if (delta !== undefined) return delta;
          if (retained(node)) return remainingOffset(node);
        }
        return undefined;
      };
      const neighbourEdge = (
        order: readonly HTMLElement[],
        index: number,
        step: -1 | 1,
        retained: (node: HTMLElement) => boolean,
      ): Edge | undefined => {
        for (let cursor = index + step; cursor >= 0 && cursor < order.length; cursor += step) {
          const node = order[cursor]!;
          const position = next.get(node);
          if (!retained(node) || position === undefined || position.height === 0) continue;
          const edge = step < 0 ? position.top + position.height : position.top;
          return { from: edge + (movedDelta.get(node) ?? remainingOffset(node)), to: edge };
        }
        return undefined;
      };
      if (!shouldAnimate) clearFades();
      else {
        for (const [node, position] of next) {
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined || previousTop === position.top) continue;
          movedDelta.set(node, previousTop + remainingOffset(node) - position.top);
        }
        for (const [node, position] of positions!) {
          if (next.has(node)) continue;
          const index = oldOrder.indexOf(node);
          const retained = (n: HTMLElement) => next.has(n);
          const delta = ridingDelta(oldOrder, index, retained);
          fadeOut(
            node,
            position,
            delta === undefined ? rowTravel(position.height) : -delta,
            neighbourEdge(oldOrder, index, -1, retained),
            neighbourEdge(oldOrder, index, 1, retained),
          );
        }
      }
      for (const [node, entry] of entering) {
        if (!next.has(node)) {
          entry.animation.cancel();
          entering.delete(node);
        }
      }
      for (const node of running.keys()) {
        if (!shouldAnimate || !next.has(node)) cancel(node);
      }
      if (shouldAnimate) {
        for (const [index, node] of nextOrder.entries()) {
          const position = next.get(node)!;
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) {
            if (position.height > 0) {
              const retained = (n: HTMLElement) => positions!.has(n);
              const delta = ridingDelta(nextOrder, index, retained);
              const travel = delta === undefined ? -rowTravel(position.height) : delta;
              const animation = node.animate(
                clippedKeyframes(
                  position.top,
                  position.height,
                  { opacity: 0, y: travel },
                  { opacity: 1, y: 0 },
                  neighbourEdge(nextOrder, index, -1, retained),
                  neighbourEdge(nextOrder, index, 1, retained),
                ),
                motionTiming,
              );
              entering.set(node, { animation, travel });
              animation.addEventListener(
                "finish",
                () => {
                  if (entering.get(node)?.animation === animation) entering.delete(node);
                },
                { once: true },
              );
            }
            continue;
          }
          const delta = movedDelta.get(node);
          // Computed progress includes easing; carry forward only our translation, never dnd-kit's
          // transforms.
          if (delta !== undefined) move(node, delta);
        }
      }
      if (released !== null) {
        if (!reducedMotion?.matches) {
          for (const [node, position] of next) {
            const top = released.get(node);
            if (top !== undefined) move(node, top - position.top);
          }
        }
        released = null;
      }
      positions = next;
    },
    release() {
      suspend();
      const origin = parent.getBoundingClientRect().top;
      released = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
          .map((node) => [node, node.getBoundingClientRect().top - origin]),
      );
    },
    suspend,
    dispose() {
      suspend();
      disposed = true;
    },
  };
}
