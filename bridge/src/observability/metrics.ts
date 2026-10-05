/**
 * Minimal metrics registry.
 *
 * Counters and gauges only — enough to answer "how many runs, how many auth
 * failures, how many in flight". Exposed on the loopback-only `/metrics` (or
 * scraped from logs); never public.
 */

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  addGauge(name: string, delta: number): void {
    this.setGauge(name, (this.gauges.get(name) ?? 0) + delta);
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number {
    return this.gauges.get(name) ?? 0;
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  /** Prometheus text exposition format. */
  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, value] of this.counters) lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
    for (const [name, value] of this.gauges) lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    return `${lines.join("\n")}\n`;
  }
}
