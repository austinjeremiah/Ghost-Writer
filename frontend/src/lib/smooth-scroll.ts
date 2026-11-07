/**
 * Lerped scroll for `#scroll-container`, replacing the template's compiled
 * `SmoothScroll` class. Settings match the original call site:
 *
 *   new SmoothScroll({ mobile: false, breakpoint: 1060, passive: false,
 *                      isFixed: true, friction: .07, stepSize: .8, scrollbar: true })
 *
 * Below the breakpoint the container falls back to native scrolling (the
 * stylesheet already switches it to `overflow-y: auto`).
 */

import { BREAKPOINT_DESKTOP } from './breakpoints';

export interface SmoothScrollOptions {
  breakpoint?: number;
  friction?: number;
  stepSize?: number;
  isFixed?: boolean;
}

export class SmoothScroll {
  readonly el: HTMLElement;

  private readonly breakpoint: number;
  private readonly friction: number;
  private readonly stepSize: number;

  private target = 0;
  private current = 0;
  private max = 0;
  private rafId: number | null = null;
  private enabled = false;
  private fixed: boolean;
  private scrolling = false;
  private scrollingTimer: ReturnType<typeof setTimeout> | null = null;
  private touchY = 0;

  private readonly listeners = new Set<(y: number, progress: number) => void>();

  constructor(el: HTMLElement, options: SmoothScrollOptions = {}) {
    this.el = el;
    this.breakpoint = options.breakpoint ?? BREAKPOINT_DESKTOP;
    this.friction = options.friction ?? 0.07;
    this.stepSize = options.stepSize ?? 0.8;
    this.fixed = options.isFixed ?? false;

    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onNativeScroll = this.onNativeScroll.bind(this);
    this.tick = this.tick.bind(this);
  }

  /** `true` while the lerped (desktop) mode is driving the container. */
  get isVirtual() {
    return this.enabled;
  }

  get scrollTop() {
    return this.enabled ? this.current : this.el.scrollTop;
  }

  get limit() {
    return this.max;
  }

  /** While fixed, wheel/touch input is ignored — used by the loader and popup. */
  get isFixed() {
    return this.fixed;
  }

  set isFixed(value: boolean) {
    this.fixed = value;
  }

  init() {
    this.measure();
    this.enabled = window.innerWidth >= this.breakpoint;

    window.addEventListener('resize', this.onResize);
    this.el.addEventListener('scroll', this.onNativeScroll, { passive: true });

    if (this.enabled) {
      this.current = this.el.scrollTop;
      this.target = this.current;
      window.addEventListener('wheel', this.onWheel, { passive: false });
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('touchstart', this.onTouchStart, { passive: true });
      window.addEventListener('touchmove', this.onTouchMove, { passive: false });
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    this.el.removeEventListener('scroll', this.onNativeScroll);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.scrollingTimer) clearTimeout(this.scrollingTimer);
    this.rafId = null;
    this.listeners.clear();
  }

  on(listener: (y: number, progress: number) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  measure() {
    this.max = Math.max(0, this.el.scrollHeight - this.el.clientHeight);
    this.target = Math.min(this.target, this.max);
  }

  scrollTo(value: number, immediate = false) {
    this.measure();
    this.target = Math.min(Math.max(value, 0), this.max);
    if (immediate || !this.enabled) {
      this.current = this.target;
      this.el.scrollTop = this.target;
    }
  }

  scrollToElement(selector: string) {
    const target = this.el.querySelector<HTMLElement>(selector);
    if (!target) return;
    const base = this.el.getBoundingClientRect().top;
    const offset = target.getBoundingClientRect().top - base;
    this.scrollTo(this.scrollTop + offset);
  }

  private markScrolling() {
    this.scrolling = true;
    if (this.scrollingTimer) clearTimeout(this.scrollingTimer);
    this.scrollingTimer = setTimeout(() => {
      this.scrolling = false;
      document.documentElement.classList.remove('is-scrolling');
    }, 400);
    document.documentElement.classList.add('is-scrolling');
  }

  private onWheel(event: WheelEvent) {
    if (!this.enabled || this.fixed) return;
    event.preventDefault();

    // Normalise the three DOM delta modes to pixels.
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= this.el.clientHeight;

    this.measure();
    this.target = Math.min(Math.max(this.target + delta * this.stepSize, 0), this.max);
    this.markScrolling();
  }

  private onTouchStart(event: TouchEvent) {
    this.touchY = event.touches[0]?.clientY ?? 0;
  }

  private onTouchMove(event: TouchEvent) {
    if (!this.enabled || this.fixed) return;
    const y = event.touches[0]?.clientY ?? 0;
    const delta = this.touchY - y;
    this.touchY = y;
    event.preventDefault();
    this.measure();
    this.target = Math.min(Math.max(this.target + delta * 2, 0), this.max);
    this.markScrolling();
  }

  private onKeyDown(event: KeyboardEvent) {
    if (!this.enabled || this.fixed) return;

    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    const page = this.el.clientHeight * 0.9;
    const steps: Record<string, number> = {
      ArrowDown: 120,
      ArrowUp: -120,
      PageDown: page,
      PageUp: -page,
      Space: page,
      Home: -this.max,
      End: this.max,
    };

    const key = event.code === 'Space' ? 'Space' : event.key;
    const step = steps[key];
    if (step === undefined) return;

    event.preventDefault();
    this.measure();
    this.target = Math.min(Math.max(this.target + step, 0), this.max);
    this.markScrolling();
  }

  private onNativeScroll() {
    if (this.enabled) return;
    this.current = this.el.scrollTop;
    this.measure();
    this.emit();
  }

  private onResize() {
    const shouldEnable = window.innerWidth >= this.breakpoint;
    this.measure();

    if (shouldEnable === this.enabled) return;

    // Crossing the breakpoint swaps the scroll implementation.
    this.destroy();
    this.init();
  }

  private emit() {
    const progress = this.max > 0 ? this.current / this.max : 0;
    for (const listener of this.listeners) listener(this.current, progress);
  }

  private tick() {
    this.rafId = requestAnimationFrame(this.tick);

    const diff = this.target - this.current;
    if (Math.abs(diff) < 0.08) {
      if (this.current !== this.target) {
        this.current = this.target;
        this.el.scrollTop = this.current;
        this.emit();
      }
      return;
    }

    this.current += diff * this.friction;
    this.el.scrollTop = this.current;
    this.emit();
  }
}

declare global {
  interface Window {
    ss?: SmoothScroll;
  }
}
