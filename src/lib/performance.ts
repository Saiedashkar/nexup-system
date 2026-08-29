/**
 * Performance utilities for Nexup Business System
 * Based on Core Web Vitals optimization best practices
 */

/**
 * Debounce function - reduces function call frequency
 * Use for: search inputs, resize handlers, scroll handlers
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function - limits function call frequency
 * Use for: scroll handlers, animation frames
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number = 100
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  let lastFn: NodeJS.Timeout;
  let lastTime: number;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      lastTime = Date.now();
      inThrottle = true;
    } else {
      clearTimeout(lastFn);
      lastFn = setTimeout(() => {
        if (Date.now() - lastTime >= limit) {
          fn(...args);
          lastTime = Date.now();
        }
      }, limit - (Date.now() - lastTime));
    }
  };
}

/**
 * Request animation frame wrapper
 * Use for: smooth animations, scroll-based updates
 */
export function raf(callback: FrameRequestCallback): number {
  return window.requestAnimationFrame(callback);
}

/**
 * Cancel animation frame
 */
export function caf(id: number): void {
  window.cancelAnimationFrame(id);
}

/**
 * Intersection Observer wrapper for lazy loading
 * Use for: lazy load images, infinite scroll, visibility tracking
 */
export function createIntersectionObserver(
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit
): IntersectionObserver {
  return new IntersectionObserver(callback, {
    rootMargin: '50px 0px',
    threshold: 0.1,
    ...options,
  });
}

/**
 * Lazy load images with Intersection Observer
 * Adds loading="lazy" and uses Intersection Observer for modern browsers
 */
export function lazyLoadImages(selector: string = 'img[data-src]'): void {
  if (typeof window === 'undefined') return;

  const images = document.querySelectorAll<HTMLImageElement>(selector);
  
  const observer = createIntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target as HTMLImageElement;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  });

  images.forEach((img) => observer.observe(img));
}

/**
 * Content visibility optimization for long lists
 * Automatically applies content-visibility: auto to list items
 */
export function optimizeListRendering(
  container: HTMLElement,
  itemSelector: string,
  estimatedHeight: number = 50
): void {
  if (typeof window === 'undefined') return;

  const items = container.querySelectorAll<HTMLElement>(itemSelector);
  
  items.forEach((item) => {
    item.style.contentVisibility = 'auto';
    item.style.containIntrinsicSize = `0 ${estimatedHeight}px`;
  });
}

/**
 * Preload critical resources
 */
export function preloadResource(
  href: string,
  as: string,
  type?: string,
  crossOrigin?: string
): void {
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'preload';
  link.href = href;
  link.as = as;
  if (type) link.type = type;
  if (crossOrigin) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

/**
 * DNS prefetch for external domains
 */
export function dnsPrefetch(hostname: string): void {
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'dns-prefetch';
  link.href = hostname;
  document.head.appendChild(link);
}

/**
 * Measure Core Web Vitals (LCP, FID, CLS)
 * Returns a promise that resolves with the metrics
 */
export async function measureWebVitals(): Promise<{
  lcp?: number;
  fid?: number;
  cls?: number;
}> {
  if (typeof window === 'undefined') return {};

  const metrics: { lcp?: number; fid?: number; cls?: number } = {};

  // Measure LCP
  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      metrics.lcp = lastEntry.startTime;
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {
    console.warn('LCP measurement not supported');
  }

  // Measure FID
  try {
    const fidObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const firstEntry = entries[0] as PerformanceEventTiming;
      metrics.fid = firstEntry.processingStart - firstEntry.startTime;
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
  } catch (e) {
    console.warn('FID measurement not supported');
  }

  // Measure CLS
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
          metrics.cls = clsValue;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch (e) {
    console.warn('CLS measurement not supported');
  }

  return metrics;
}

/**
 * Virtual scrolling helper for long lists
 * Only renders visible items + buffer
 */
export class VirtualScroller {
  private container: HTMLElement;
  private items: any[];
  private itemHeight: number;
  private buffer: number;
  private renderedRange: { start: number; end: number } = { start: 0, end: 0 };

  constructor(
    container: HTMLElement,
    items: any[],
    itemHeight: number = 50,
    buffer: number = 5
  ) {
    this.container = container;
    this.items = items;
    this.itemHeight = itemHeight;
    this.buffer = buffer;
  }

  /**
   * Get visible range based on scroll position
   */
  getVisibleRange(): { start: number; end: number } {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;
    
    const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
    const end = Math.min(
      this.items.length,
      Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.buffer
    );

    return { start, end };
  }

  /**
   * Update rendered items
   */
  update(): { start: number; end: number; items: any[] } {
    const range = this.getVisibleRange();
    
    if (
      range.start === this.renderedRange.start &&
      range.end === this.renderedRange.end
    ) {
      return { ...range, items: [] };
    }

    this.renderedRange = range;
    return {
      ...range,
      items: this.items.slice(range.start, range.end),
    };
  }

  /**
   * Get total scroll height
   */
  getTotalHeight(): number {
    return this.items.length * this.itemHeight;
  }

  /**
   * Get offset for visible items
   */
  getOffset(): number {
    return this.renderedRange.start * this.itemHeight;
  }
}

/**
 * Batch DOM updates to avoid layout thrashing
 */
export function batchUpdates(updates: (() => void)[]): void {
  // Group all reads first
  const reads: (() => void)[] = [];
  const writes: (() => void)[] = [];

  updates.forEach((update) => {
    // Simple heuristic: if it reads DOM state, it's a read
    // In practice, you'd need to analyze the function
    writes.push(update);
  });

  // Execute all writes in a single frame
  requestAnimationFrame(() => {
    writes.forEach((write) => write());
  });
}

/**
 * Prefetch route for faster navigation
 */
export function prefetchRoute(href: string): void {
  if (typeof document === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.appendChild(link);
}
