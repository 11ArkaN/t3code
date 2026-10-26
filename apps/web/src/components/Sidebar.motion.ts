const motionTiming = { duration: 150, easing: "ease-out" };
const rowTravel = (height: number) => Math.min(height, 40);
// Fades clone removed rows and animate clones and entries; intervening layout reads force reflows.
const MAX_FADED_ROWS_PER_UPDATE = 40;

type RowPosition = { top: number; left: number; width: number; height: number };
type Edge = { from: number; to: number };
type Frame = { opacity: number; y: number };
type EdgeOf = (node: HTMLElement | undefined, step: -1 | 1) => Edge | undefined;
type Exit = {
  animation: Animation;
  top: number;
  height: number;
  from: Frame;
  to: Frame;
  above: HTMLElement | undefined;
  below: HTMLElement | undefined;
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Clip a travelling row to the space between its neighbours' edges so it never paints over them. */
function clippedKeyframes(
  top: number,
  height: number,
  from: Frame,
  to: Frame,
  above: Edge | undefined,
  below: Edge | undefined,
): Keyframe[] {
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
  const entering = new Map<
    HTMLElement,
    { animation: Animation; travel: number; opacity: number }
  >();
  const exiting = new Map<HTMLElement, Exit>();
  let released: Map<HTMLElement, number> | null = null;

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node);
    const run = current ? current.offset * (1 - progress(current.animation)) : 0;
    const entry = entering.get(node);
    const enter = entry ? entry.travel * (1 - progress(entry.animation)) : 0;
    return run + enter;
  };
  const entryOpacity = (node: HTMLElement) => {
    const entry = entering.get(node);
    return entry ? lerp(entry.opacity, 1, progress(entry.animation)) : 1;
  };
  const clearFades = () => {
    for (const entry of entering.values()) entry.animation.cancel();
    for (const exit of exiting.values()) exit.animation.cancel();
    for (const node of exiting.keys()) node.remove();
    entering.clear();
    exiting.clear();
  };
  const animateExit = (clone: HTMLElement, exit: Omit<Exit, "animation">, edges: EdgeOf) => {
    const animation = clone.animate(
      clippedKeyframes(
        exit.top,
        exit.height,
        exit.from,
        exit.to,
        edges(exit.above, -1),
        edges(exit.below, 1),
      ),
      { ...motionTiming, fill: "forwards" },
    );
    exiting.set(clone, { ...exit, animation });
    animation.addEventListener(
      "finish",
      () => {
        if (exiting.get(clone)?.animation !== animation) return;
        clone.remove();
        exiting.delete(clone);
      },
      { once: true },
    );
  };
  const fadeOut = (
    node: HTMLElement,
    position: RowPosition,
    travel: number,
    above: HTMLElement | undefined,
    below: HTMLElement | undefined,
    edges: EdgeOf,
  ) => {
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
    animateExit(
      clone,
      {
        top,
        height: position.height,
        from: { opacity: entryOpacity(node), y: 0 },
        to: { opacity: 0, y: travel },
        above,
        below,
      },
      edges,
    );
  };
  const enter = (
    node: HTMLElement,
    position: RowPosition,
    from: Frame,
    above?: Edge,
    below?: Edge,
  ) => {
    const animation = node.animate(
      clippedKeyframes(position.top, position.height, from, { opacity: 1, y: 0 }, above, below),
      motionTiming,
    );
    entering.set(node, { animation, travel: from.y, opacity: from.opacity });
    animation.addEventListener(
      "finish",
      () => {
        if (entering.get(node)?.animation === animation) entering.delete(node);
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
    if (offset === 0) return;
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
      const layoutChanged =
        positions !== null &&
        (next.size !== positions.size ||
          [...next].some(([node, position]) => {
            const previous = positions!.get(node);
            return previous?.top !== position.top || previous.height !== position.height;
          }));
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
      const neighbour = (
        order: readonly HTMLElement[],
        index: number,
        step: -1 | 1,
        retained: (node: HTMLElement) => boolean,
      ) => {
        for (let cursor = index + step; cursor >= 0 && cursor < order.length; cursor += step) {
          const node = order[cursor]!;
          if (retained(node) && next.get(node)?.height) return node;
        }
        return undefined;
      };
      const edges: EdgeOf = (node, step) => {
        const position = node && next.get(node);
        if (!node || !position?.height) return undefined;
        const edge = step < 0 ? position.top + position.height : position.top;
        return { from: edge + (movedDelta.get(node) ?? remainingOffset(node)), to: edge };
      };
      const neighbourEdge = (...args: Parameters<typeof neighbour>) =>
        edges(neighbour(...args), args[2]);
      if (!shouldAnimate) clearFades();
      else if (layoutChanged) {
        // Every active motion restarts on one shared timeline so neighbour clips stay linear.
        for (const [node, position] of next) {
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) continue;
          if (previousTop === position.top && !running.has(node) && !entering.has(node)) continue;
          movedDelta.set(node, previousTop + remainingOffset(node) - position.top);
        }
        for (const [clone, exit] of exiting) {
          const p = progress(exit.animation);
          exit.animation.cancel();
          if (
            (exit.above && !next.get(exit.above)?.height) ||
            (exit.below && !next.get(exit.below)?.height)
          ) {
            clone.remove();
            exiting.delete(clone);
            continue;
          }
          animateExit(
            clone,
            {
              ...exit,
              from: { opacity: lerp(exit.from.opacity, 0, p), y: lerp(exit.from.y, exit.to.y, p) },
            },
            edges,
          );
        }
        for (const [node, position] of positions!) {
          if (next.has(node) || position.height === 0) continue;
          const index = oldOrder.indexOf(node);
          const retained = (n: HTMLElement) => next.has(n);
          const delta = ridingDelta(oldOrder, index, retained);
          fadeOut(
            node,
            position,
            delta === undefined ? rowTravel(position.height) : -delta,
            neighbour(oldOrder, index, -1, retained),
            neighbour(oldOrder, index, 1, retained),
            edges,
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
        const retained = (n: HTMLElement) => positions!.has(n);
        for (const [index, node] of nextOrder.entries()) {
          const position = next.get(node)!;
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) {
            if (position.height > 0) {
              const delta = ridingDelta(nextOrder, index, retained);
              enter(
                node,
                position,
                { opacity: 0, y: delta === undefined ? -rowTravel(position.height) : delta },
                neighbourEdge(nextOrder, index, -1, retained),
                neighbourEdge(nextOrder, index, 1, retained),
              );
            }
            continue;
          }
          // Computed progress includes easing; carry forward only our translation, never dnd-kit's
          // transforms.
          const delta = movedDelta.get(node);
          if (delta === undefined) continue;
          const entry = entering.get(node);
          if (entry) {
            const opacity = entryOpacity(node);
            cancel(node);
            entry.animation.cancel();
            enter(
              node,
              position,
              { opacity, y: delta },
              neighbourEdge(nextOrder, index, -1, retained),
              neighbourEdge(nextOrder, index, 1, retained),
            );
          } else move(node, delta);
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
