/** 小说和漫画共用输入：键盘、左右半屏点击、文字选择、卷页拖动。
 * 文字拖选优先，页边／插画拖动才接管翻页；坐标统一到正文容器。
 * TurnGesture 只保存进度和提交／回弹，不修改书籍位置，由引擎事务消费。
 */
export class TurnGesture {
  progress = 0;
  y = 0.85;
  committed?: boolean;
  private listeners = new Set<() => void>();
  update(progress: number, y: number) {
    if (this.committed !== undefined) return;
    this.progress = Math.max(0, Math.min(1, progress));
    this.y = Math.max(0.05, Math.min(0.95, y));
    this.listeners.forEach((listener) => listener());
  }
  finish(commit = this.progress >= 0.5) {
    if (this.committed !== undefined) return;
    this.committed = commit;
    this.listeners.forEach((listener) => listener());
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }
}
export type NavigationAction = "next" | "previous";
export type ReadingMove = (
  action: NavigationAction,
  gesture?: TurnGesture,
) => void;
const NEXT = new Set(["ArrowDown", "ArrowRight", "PageDown", " ", "Enter"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);
// 换章允许旧 iframe 的拖动继续；关闭整本书则由稳定的正文容器取消。
// WeakMap 不延长正文节点的生命周期，也不会积累已经退出的阅读器。
const liveGestures = new WeakMap<HTMLElement, () => void>();
export function keyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "isComposing"
  >,
): NavigationAction | undefined {
  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  )
    return;
  if (NEXT.has(event.key)) return "next";
  if (PREVIOUS.has(event.key)) return "previous";
}
export function isInteractive(target: EventTarget | null) {
  // EPUB/TXT elements belong to another Window. Parent-realm instanceof checks
  // reject those elements and Documents even when they have the same DOM type.
  return (
    (target as Node | null)?.nodeType === 1 &&
    !!(target as Element).closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [data-no-page]',
    )
  );
}
// caretRangeFromPoint also returns the nearest text when clicking a margin.
// Test the actual glyph box so a margin/image drag still turns the page.
function hitsText(document: Document, event: MouseEvent) {
  const caret = (
    document as Document & {
      caretRangeFromPoint?(x: number, y: number): Range | null;
    }
  ).caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!caret || caret.startContainer.nodeType !== 3) return false;
  const node = caret.startContainer;
  const length = node.textContent?.length ?? 0;
  if (!length) return false;
  const offset = Math.min(caret.startOffset, length - 1);
  caret.setStart(node, offset);
  caret.setEnd(node, offset + 1);
  const rect = caret.getBoundingClientRect();
  return (
    event.clientX >= rect.left - 1 &&
    event.clientX <= rect.right + 1 &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}
export function bindReadingInput(
  target: Document | HTMLElement,
  move: ReadingMove,
  enabled: () => boolean,
  surface: HTMLElement,
  draggable: () => boolean,
  scroll?: { enabled: () => boolean; by: (dx: number, dy: number) => void },
) {
  let pointerStart:
    | {
        id: number;
        x: number;
        y: number;
        action: NavigationAction;
        selecting: boolean;
        lastX: number;
        lastY: number;
        capture?: Element;
        gesture?: TurnGesture;
      }
    | undefined;
  let suppressClick = false;
  let proxy: HTMLElement | undefined;
  let detached = false;
  const document =
    target.nodeType === 9 ? (target as Document) : target.ownerDocument;
  const position = (event: MouseEvent) => {
    const node = event.target as Node | null;
    const eventDocument =
      node?.nodeType === 9
        ? (node as Document)
        : (node?.ownerDocument ?? document);
    const frame = eventDocument?.defaultView?.frameElement;
    const rect = frame?.getBoundingClientRect();
    return {
      x: event.clientX + (rect?.left ?? 0),
      y: event.clientY + (rect?.top ?? 0),
    };
  };
  const clickAction = (x: number): NavigationAction =>
    x < surface.getBoundingClientRect().left + surface.clientWidth / 2
      ? "previous"
      : "next";
  const keydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key === "Escape" || key.key === "F11")
      pointerStart?.gesture?.finish(false);
    const parentShortcut =
      key.key === "Escape" ||
      key.key === "F11" ||
      (key.ctrlKey && [",", "o"].includes(key.key.toLowerCase()));
    if (
      parentShortcut &&
      target.nodeType === 9 &&
      (target as Document).defaultView?.frameElement
    ) {
      key.preventDefault();
      (target as Document).defaultView?.parent.document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: key.key,
          ctrlKey: key.ctrlKey,
          altKey: key.altKey,
          shiftKey: key.shiftKey,
          metaKey: key.metaKey,
          bubbles: true,
        }),
      );
      return;
    }
    if (!enabled() || isInteractive(key.target)) return;
    const action = keyAction(key);
    if (action) {
      key.preventDefault();
      // The paginator's selection handler must not interpret page shortcuts as
      // text-caret movement and scroll back to that caret during reflow.
      key.stopImmediatePropagation();
      move(action);
    }
  };
  const pointerdown = (event: Event) => {
    const pointer = event as PointerEvent;
    if (!enabled() || isInteractive(pointer.target) || pointer.button !== 0)
      return;
    const { x, y } = position(pointer);
    const selecting = pointer.shiftKey || hitsText(document!, pointer);
    if (!selecting) {
      surface.tabIndex = -1;
      surface.focus({ preventScroll: true });
    }
    let capture: Element | undefined;
    if (!selecting && (draggable() || scroll?.enabled())) {
      pointer.preventDefault();
      // Capture before the first move: an outer-margin drag otherwise enters
      // the iframe before the proxy exists and loses its initial pointerdown.
      const element =
        target.nodeType === 9 ? document!.documentElement : surface;
      try {
        element.setPointerCapture(pointer.pointerId);
        capture = element;
      } catch {}
    }
    suppressClick = false;
    pointerStart = {
      id: pointer.pointerId,
      x,
      y,
      lastX: x,
      lastY: y,
      selecting,
      capture,
      action: clickAction(x),
    };
  };
  const pointermove = (event: Event) => {
    const pointer = event as PointerEvent,
      start = pointerStart;
    if (
      !start ||
      pointer.pointerId !== start.id ||
      !enabled() ||
      start.selecting
    )
      return;
    const { x, y } = position(pointer);
    if (scroll?.enabled()) {
      if (!suppressClick && Math.hypot(x - start.x, y - start.y) < 5) return;
      startProxy();
      pointer.preventDefault();
      scroll.by(start.lastX - x, start.lastY - y);
      start.lastX = x;
      start.lastY = y;
      suppressClick = true;
      return;
    }
    if (!draggable()) return;
    const distance = (x - start.x) * (start.action === "next" ? -1 : 1);
    if (!start.gesture) {
      if (distance < 8 || distance < Math.abs(y - start.y)) return;
      start.gesture = new TurnGesture();
      // A chapter change destroys its iframe. Continue the gesture in the stable
      // parent document, so dragging across a chapter never loses pointerup.
      startProxy();
      document?.getSelection()?.removeAllRanges();
      move(start.action, start.gesture);
    }
    pointer.preventDefault();
    const rect = surface.getBoundingClientRect();
    start.gesture.update(distance / rect.width, (y - rect.top) / rect.height);
    suppressClick = true;
  };
  const pointerup = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointerStart?.id !== pointer.pointerId) return;
    const point = position(pointer);
    suppressClick ||=
      Math.hypot(point.x - pointerStart.x, point.y - pointerStart.y) > 5;
    pointerStart.gesture?.finish(
      pointer.type === "pointercancel" ? false : undefined,
    );
    if (pointerStart.capture?.hasPointerCapture(pointer.pointerId))
      pointerStart.capture.releasePointerCapture(pointer.pointerId);
    pointerStart = undefined;
    removeProxy();
  };
  const click = (event: Event) => {
    const mouse = event as MouseEvent;
    if (!enabled() || isInteractive(mouse.target) || mouse.button !== 0) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (document?.getSelection()?.toString()) return;
    if (
      pointerStart &&
      Math.hypot(
        position(mouse).x - pointerStart.x,
        position(mouse).y - pointerStart.y,
      ) > 5
    )
      return;
    move(clickAction(position(mouse).x));
  };
  const contextmenu = (event: Event) => {
    if (!document?.getSelection()?.toString()) event.preventDefault();
  };
  // Native HTML image/text dragging starts a separate OS drag session and
  // cancels pointer events. Selection and the reader's own turn gesture own it.
  const dragstart = (event: Event) => event.preventDefault();
  const wheel = (event: Event) => {
    const e = event as WheelEvent;
    if (
      !enabled() ||
      !scroll?.enabled() ||
      e.ctrlKey ||
      isInteractive(e.target)
    )
      return;
    e.preventDefault();
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? surface.clientHeight : 1;
    scroll.by(e.deltaX * unit, e.deltaY * unit);
  };
  // 小说换章会销毁旧 iframe。卷页和上下拖动都把后续指针事件交给
  // 稳定的主文档，避免跨章后丢失拖动或鼠标松开事件；文字选择不接管。
  const startProxy = () => {
    if (proxy) return;
    const rect = surface.getBoundingClientRect();
    proxy = surface.ownerDocument.createElement("div");
    proxy.className = "turn-pointer";
    proxy.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:40;touch-action:none;cursor:grabbing`;
    surface.ownerDocument.body.append(proxy);
    liveGestures.set(surface, cancel);
    surface.ownerDocument.addEventListener("pointermove", pointermove);
    surface.ownerDocument.addEventListener("pointerup", pointerup);
    surface.ownerDocument.addEventListener("pointercancel", pointerup);
    surface.ownerDocument.addEventListener("keydown", cancel);
  };
  const removeProxy = () => {
    proxy?.remove();
    proxy = undefined;
    if (liveGestures.get(surface) === cancel) liveGestures.delete(surface);
    surface.ownerDocument.removeEventListener("pointermove", pointermove);
    surface.ownerDocument.removeEventListener("pointerup", pointerup);
    surface.ownerDocument.removeEventListener("pointercancel", pointerup);
    surface.ownerDocument.removeEventListener("keydown", cancel);
    if (detached)
      surface.ownerDocument.defaultView?.removeEventListener("blur", cancel);
  };
  const cancel = (event?: Event) => {
    if (
      event?.type === "keydown" &&
      !["Escape", "F11"].includes((event as KeyboardEvent).key)
    )
      return;
    pointerStart?.gesture?.finish(false);
    pointerStart = undefined;
    removeProxy();
  };
  surface.ownerDocument.defaultView?.addEventListener("blur", cancel);
  target.addEventListener("keydown", keydown, true);
  target.addEventListener("pointerdown", pointerdown);
  target.addEventListener("pointermove", pointermove);
  target.addEventListener("pointerup", pointerup);
  target.addEventListener("pointercancel", pointerup);
  target.addEventListener("click", click);
  target.addEventListener("contextmenu", contextmenu);
  target.addEventListener("dragstart", dragstart);
  if (scroll) target.addEventListener("wheel", wheel, { passive: false });
  return () => {
    if (target === surface) liveGestures.get(surface)?.();
    detached = true;
    if (!proxy)
      surface.ownerDocument.defaultView?.removeEventListener("blur", cancel);
    target.removeEventListener("keydown", keydown, true);
    target.removeEventListener("pointerdown", pointerdown);
    target.removeEventListener("pointermove", pointermove);
    target.removeEventListener("pointerup", pointerup);
    target.removeEventListener("pointercancel", pointerup);
    target.removeEventListener("click", click);
    target.removeEventListener("contextmenu", contextmenu);
    target.removeEventListener("dragstart", dragstart);
    target.removeEventListener("wheel", wheel);
  };
}
