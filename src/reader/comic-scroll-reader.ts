/** A bounded continuous comic strip. Only five decoded page nodes are kept. */
export class VerticalPages {
  private sizes: number[];
  private mounted = new Map<number, HTMLElement>();
  private loading = new Map<number, Promise<void>>();
  private strip = document.createElement("div");
  private top = document.createElement("div");
  private bottom = document.createElement("div");
  private request = 0;
  private generation = 0;
  private disposed = false;
  private pointer?: { id: number; y: number; scroll: number; moved: boolean };
  private index: number;
  private aligning = true;
  constructor(
    private host: HTMLElement,
    private count: number,
    private load: (index: number) => Promise<HTMLElement>,
    private changed: (index: number) => void,
    initialIndex = 0,
  ) {
    this.index = Math.max(0, Math.min(count - 1, initialIndex));
    this.sizes = Array(count).fill(Math.max(200, host.clientWidth * 1.33));
    this.strip.className = "vertical-pages";
    this.top.className = this.bottom.className = "page-spacer";
    this.host.classList.add("vertical-surface");
    this.strip.append(this.top, this.bottom);
    host.replaceChildren(this.strip);
    host.addEventListener("scroll", this.onScroll, { passive: true });
    host.addEventListener("pointerdown", this.onDown);
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerup", this.onUp);
    host.addEventListener("pointercancel", this.onUp);
    host.addEventListener("click", this.onClick, true);
  }
  private offset(index: number) {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += this.sizes[i];
    return sum;
  }
  private onScroll = () => {
    if (this.request || this.aligning) return;
    this.request = requestAnimationFrame(() => {
      this.request = 0;
      if (this.disposed || this.aligning) return;
      let offset = 0,
        next = this.count - 1;
      const position = this.host.scrollTop + 2;
      for (let index = 0; index < this.count; index++) {
        offset += this.sizes[index];
        if (offset > position) {
          next = index;
          break;
        }
      }
      if (next !== this.index) {
        this.index = next;
        this.changed(next);
        void this.populate(next);
      }
    });
  };
  private onDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest?.("[data-no-page]")
    )
      return;
    this.pointer = {
      id: event.pointerId,
      y: event.clientY,
      scroll: this.host.scrollTop,
      moved: false,
    };
  };
  private onMove = (event: PointerEvent) => {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    if (Math.abs(event.clientY - this.pointer.y) > 5) {
      this.pointer.moved = true;
      this.host.setPointerCapture(event.pointerId);
    }
    if (this.pointer.moved) {
      this.host.scrollTop =
        this.pointer.scroll + this.pointer.y - event.clientY;
      event.preventDefault();
    }
  };
  private onUp = (event: PointerEvent) => {
    if (this.pointer?.moved) {
      this.host.dataset.dragged = "true";
      setTimeout(() => {
        delete this.host.dataset.dragged;
      }, 0);
    }
    if (this.host.hasPointerCapture(event.pointerId))
      this.host.releasePointerCapture(event.pointerId);
    this.pointer = undefined;
  };
  private onClick = (event: MouseEvent) => {
    if (this.host.dataset.dragged) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  };
  private async populate(index: number) {
    const generation = ++this.generation;
    const first = Math.max(0, index - 2),
      last = Math.min(this.count - 1, index + 2);
    // Removing old nodes before loading bounds decoded memory during fast scrolling.
    for (const [page, node] of this.mounted)
      if (page < first || page > last) {
        node.remove();
        this.mounted.delete(page);
      }
    // Start the visible page first; GPU jobs are serialized, so prefetch must wait.
    const priority = [index, index + 1, index - 1, index + 2, index - 2].filter(
      (page) => page >= first && page <= last,
    );
    for (const page of priority) {
      if (!this.mounted.has(page)) {
        const slot = document.createElement("div");
        slot.className = "vertical-page";
        slot.dataset.page = String(page);
        slot.style.height = `${this.sizes[page]}px`;
        this.mounted.set(page, slot);
        const loading = this.load(page)
          .then((image) => {
            if (this.disposed || this.mounted.get(page) !== slot) return;
            image.style.width = "100%";
            image.style.height = "auto";
            image.style.maxWidth = "none";
            image.style.maxHeight = "none";
            slot.replaceChildren(image);
            this.measure();
          })
          .catch((error) => {
            if (
              !this.disposed &&
              slot.isConnected &&
              error?.name !== "AbortError"
            ) {
              slot.textContent =
                error instanceof Error ? error.message : String(error);
            }
          })
          .finally(() => {
            if (this.loading.get(page) === loading) this.loading.delete(page);
          });
        this.loading.set(page, loading);
      }
    }
    if (this.disposed || generation !== this.generation) return;
    const nodes = [...this.mounted]
      .sort(([a], [b]) => a - b)
      .map(([, node]) => node);
    this.strip.replaceChildren(this.top, ...nodes, this.bottom);
    this.spacers(first, last);
    // Wait for the destination image to know its height and make keyboard turns exact.
    await this.loading.get(index);
  }
  private spacers(first: number, last: number) {
    this.top.style.height = `${this.offset(first)}px`;
    const tail = Math.max(
      0,
      this.host.clientHeight - this.sizes[this.count - 1],
    );
    this.bottom.style.height = `${this.offset(this.count) - this.offset(last + 1) + tail}px`;
  }
  private measure() {
    const before = this.offset(this.index),
      relative = this.host.scrollTop - before;
    for (const [index, node] of this.mounted) {
      const frame = node.querySelector<HTMLElement>(".image-frame");
      const width = Number(frame?.dataset.sourceWidth),
        height = Number(frame?.dataset.sourceHeight);
      if (width) {
        this.sizes[index] = (this.strip.clientWidth * height) / width;
        node.style.height = `${this.sizes[index]}px`;
      }
    }
    const pages = [...this.mounted.keys()];
    if (pages.length) this.spacers(Math.min(...pages), Math.max(...pages));
    this.host.scrollTop = this.offset(this.index) + Math.max(0, relative);
  }
  async goTo(index: number) {
    // Replacing the strip resets scrollTop before image decoding completes.
    // Track user scrolling only after the requested page has been aligned.
    this.aligning = true;
    try {
      this.index = Math.max(0, Math.min(this.count - 1, index));
      this.changed(this.index);
      await this.populate(this.index);
      if (this.disposed) return;
      this.host.scrollTo({
        top: this.offset(this.index),
        left: 0,
        behavior: "instant",
      });
    } finally {
      this.aligning = false;
    }
  }
  async resize(width: number) {
    const oldWidth = this.strip.getBoundingClientRect().width;
    const relative = this.host.scrollTop - this.offset(this.index);
    this.strip.style.width = `${width}px`;
    if (oldWidth > 0)
      this.sizes = this.sizes.map((height) => (height * width) / oldWidth);
    this.measure();
    this.host.scrollTop =
      this.offset(this.index) +
      Math.max(0, (relative * width) / Math.max(1, oldWidth));
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.request);
    this.host.removeEventListener("scroll", this.onScroll);
    this.host.removeEventListener("pointerdown", this.onDown);
    this.host.removeEventListener("pointermove", this.onMove);
    this.host.removeEventListener("pointerup", this.onUp);
    this.host.removeEventListener("pointercancel", this.onUp);
    this.host.removeEventListener("click", this.onClick, true);
    this.host.classList.remove("vertical-surface");
    this.strip.remove();
    this.mounted.clear();
    this.loading.clear();
  }
}
