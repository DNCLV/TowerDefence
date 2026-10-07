/** Presentation and input for the bounded, faction-driven build wheel. Gameplay selection stays with the caller. */
export class BuildCarousel {
  private selectedIndex = 0;
  private targetIndex: number | undefined;
  private targetStartedAt = 0;
  private scrollTimer = 0;
  private settleTimer = 0;
  private dragPointerId: number | undefined;
  private dragStartX = 0;
  private dragStartScroll = 0;
  private didDrag = false;
  private suppressClick = false;
  private touchIdentifier: number | undefined;
  private touchStartX = 0;
  private touchStartScroll = 0;
  private didTouchDrag = false;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly items: readonly HTMLButtonElement[],
    private readonly previous: HTMLButtonElement,
    private readonly next: HTMLButtonElement,
    private readonly onSelect: (index: number) => void,
    signal: AbortSignal,
  ) {
    viewport.addEventListener("scroll", () => this.onScroll(), { passive: true, signal });
    viewport.addEventListener("wheel", (event) => {
      const motion = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!motion) return;
      this.cancelScrollAnimation();
      this.targetIndex = undefined;
      viewport.scrollLeft += motion;
      event.preventDefault();
      this.scheduleSettle();
    }, { passive: false, signal });
    viewport.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      this.cancelScrollAnimation();
      this.targetIndex = undefined;
      this.touchIdentifier = touch.identifier;
      this.touchStartX = touch.clientX;
      this.touchStartScroll = viewport.scrollLeft;
      this.didTouchDrag = false;
    }, { passive: true, signal });
    viewport.addEventListener("touchmove", (event) => {
      const touch = Array.from(event.changedTouches).find((candidate) => candidate.identifier === this.touchIdentifier);
      if (!touch) return;
      const distance = touch.clientX - this.touchStartX;
      if (!this.didTouchDrag && Math.abs(distance) < 6) return;
      this.didTouchDrag = true;
      viewport.scrollLeft = this.touchStartScroll - distance;
      event.preventDefault();
    }, { passive: false, signal });
    const finishTouch = (event: TouchEvent): void => {
      if (!Array.from(event.changedTouches).some((touch) => touch.identifier === this.touchIdentifier)) return;
      this.touchIdentifier = undefined;
      if (!this.didTouchDrag) return;
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 250);
      this.scheduleSettle();
    };
    viewport.addEventListener("touchend", finishTouch, { signal });
    viewport.addEventListener("touchcancel", finishTouch, { signal });
    viewport.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      this.choose(this.selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
    }, { signal });
    previous.addEventListener("click", () => this.choose(this.selectedIndex - 1), { signal });
    next.addEventListener("click", () => this.choose(this.selectedIndex + 1), { signal });

    // Native touch panning handles phones. A short mouse drag handles desktop without
    // turning an ordinary click on a neighboring unit into a drag.
    viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      this.dragPointerId = event.pointerId;
      this.dragStartX = event.clientX;
      this.dragStartScroll = viewport.scrollLeft;
      this.didDrag = false;
      this.cancelScrollAnimation();
      this.targetIndex = undefined;
    }, { signal });
    viewport.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.dragPointerId) return;
      const distance = event.clientX - this.dragStartX;
      if (!this.didDrag && Math.abs(distance) < 6) return;
      if (!this.didDrag) {
        this.didDrag = true;
        viewport.setPointerCapture(event.pointerId);
      }
      viewport.scrollLeft = this.dragStartScroll - distance;
      event.preventDefault();
    }, { signal });
    const finishDrag = (event: PointerEvent): void => {
      if (event.pointerId !== this.dragPointerId) return;
      this.dragPointerId = undefined;
      if (!this.didDrag) return;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 250);
      this.scheduleSettle();
    };
    viewport.addEventListener("pointerup", finishDrag, { signal });
    viewport.addEventListener("pointercancel", finishDrag, { signal });
    viewport.addEventListener("click", (event) => {
      if (!this.suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.suppressClick = false;
    }, { capture: true, signal });
    signal.addEventListener("abort", () => {
      this.cancelScrollAnimation();
      window.clearTimeout(this.settleTimer);
    }, { once: true });
    this.refresh();
  }

  setSelected(index: number, animate = true): void {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, index));
    this.previous.disabled = this.selectedIndex === 0;
    this.next.disabled = this.selectedIndex === this.items.length - 1;
    this.targetIndex = this.selectedIndex;
    this.targetStartedAt = performance.now();
    this.centerSelected(animate);
  }

  refresh(): void {
    this.centerSelected(false);
  }

  private choose(index: number): void {
    const item = this.items[index];
    if (!item || item.disabled) return;
    this.onSelect(index);
    item.focus({ preventScroll: true });
  }

  private centerSelected(animate: boolean): void {
    const item = this.items[this.selectedIndex];
    if (!item) return;
    const left = item.offsetLeft + item.offsetWidth / 2 - this.viewport.clientWidth / 2;
    this.cancelScrollAnimation();
    const start = this.viewport.scrollLeft;
    if (!animate || Math.abs(left - start) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.viewport.scrollTo({ left, behavior: "instant" });
      this.updateVisuals();
      return;
    }
    const started = performance.now();
    const tick = (): void => {
      const now = performance.now();
      const progress = Math.min(1, (now - started) / 220);
      const eased = 1 - (1 - progress) ** 3;
      this.viewport.scrollTo({ left: start + (left - start) * eased, behavior: "instant" });
      this.updateVisuals();
      if (progress >= 1) {
        this.cancelScrollAnimation();
        this.scheduleSettle();
      }
    };
    this.scrollTimer = window.setInterval(tick, 16);
  }

  private onScroll(): void {
    this.updateVisuals();
    this.scheduleSettle();
  }

  private cancelScrollAnimation(): void {
    if (this.scrollTimer) window.clearInterval(this.scrollTimer);
    this.scrollTimer = 0;
  }

  private scheduleSettle(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settle(), 110);
  }

  private settle(): void {
    if (this.dragPointerId !== undefined) return;
    if (this.targetIndex !== undefined) {
      const item = this.items[this.targetIndex];
      const target = item.offsetLeft + item.offsetWidth / 2 - this.viewport.clientWidth / 2;
      if (Math.abs(this.viewport.scrollLeft - target) > 3 && performance.now() - this.targetStartedAt < 500) {
        this.scheduleSettle();
        return;
      }
      this.targetIndex = undefined;
    }
    const center = this.viewport.scrollLeft + this.viewport.clientWidth / 2;
    const nearest = this.items.reduce((best, item, index) =>
      Math.abs(item.offsetLeft + item.offsetWidth / 2 - center)
        < Math.abs(this.items[best].offsetLeft + this.items[best].offsetWidth / 2 - center) ? index : best, 0);
    if (nearest !== this.selectedIndex && !this.items[nearest].disabled) this.onSelect(nearest);
    else this.centerSelected(true);
  }

  private updateVisuals(): void {
    const center = this.viewport.scrollLeft + this.viewport.clientWidth / 2;
    this.items.forEach((item) => {
      const distance = Math.min(2, Math.abs(item.offsetLeft + item.offsetWidth / 2 - center) / (item.offsetWidth + 7));
      item.style.transform = `translateY(${(distance * 5).toFixed(1)}px) scale(${(1 - distance * 0.15).toFixed(3)})`;
      item.style.opacity = String(Math.max(0.44, 1 - distance * 0.27));
      item.style.zIndex = String(3 - Math.round(distance));
      item.dataset.wheelPosition = distance < 0.35 ? "center" : distance < 1.35 ? "adjacent" : "outer";
    });
  }
}
