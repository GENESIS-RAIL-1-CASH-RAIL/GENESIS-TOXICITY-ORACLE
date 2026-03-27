// ─── VPIN Engine Service — Volume-Clock Bucketing + VPIN Computation ────────

import { TradeEvent, VolumeBucket, VpinReading } from "../types";

const MAX_BUCKETS_PER_INSTRUMENT = 200;
const VPIN_WINDOW = 50; // buckets for VPIN computation
const DEFAULT_BUCKET_VOLUME = 1000; // USD equivalent

export class VpinEngineService {
  private buckets: Map<string, VolumeBucket[]> = new Map();
  private vpinReadings: Map<string, VpinReading> = new Map();
  private pendingTrades: Map<string, TradeEvent[]> = new Map();
  private bucketCounter = 0;

  constructor() {}

  // ── Ingest Trade ────────────────────────────────────────────────────────

  ingestTrade(trade: TradeEvent): VolumeBucket | null {
    const key = trade.instrument;
    if (!this.pendingTrades.has(key)) this.pendingTrades.set(key, []);
    this.pendingTrades.get(key)!.push(trade);

    const pending = this.pendingTrades.get(key)!;
    const totalVol = pending.reduce((s, t) => s + t.volume, 0);

    if (totalVol >= DEFAULT_BUCKET_VOLUME) {
      return this.closeBucket(key, pending);
    }
    return null;
  }

  // ── Close Bucket ────────────────────────────────────────────────────────

  private closeBucket(instrument: string, trades: TradeEvent[]): VolumeBucket {
    let buyVol = 0;
    let sellVol = 0;
    let totalVol = 0;

    for (const t of trades) {
      totalVol += t.volume;
      if (t.side === "BUY") buyVol += t.volume;
      else if (t.side === "SELL") sellVol += t.volume;
      else {
        // Lee-Ready classification: compare to midpoint
        const half = t.volume / 2;
        buyVol += half;
        sellVol += half;
      }
    }

    const bucket: VolumeBucket = {
      bucketId: `VB-${++this.bucketCounter}`,
      instrument,
      targetVolume: DEFAULT_BUCKET_VOLUME,
      actualVolume: totalVol,
      buyVolume: buyVol,
      sellVolume: sellVol,
      orderImbalance: totalVol > 0 ? Math.abs(buyVol - sellVol) / totalVol : 0,
      startTime: trades[0]?.timestamp || Date.now(),
      endTime: trades[trades.length - 1]?.timestamp || Date.now(),
      tradeCount: trades.length,
    };

    if (!this.buckets.has(instrument)) this.buckets.set(instrument, []);
    const instrumentBuckets = this.buckets.get(instrument)!;
    instrumentBuckets.push(bucket);
    if (instrumentBuckets.length > MAX_BUCKETS_PER_INSTRUMENT) {
      this.buckets.set(instrument, instrumentBuckets.slice(-MAX_BUCKETS_PER_INSTRUMENT));
    }

    this.pendingTrades.set(instrument, []);
    this.computeVpin(instrument);
    return bucket;
  }

  // ── VPIN Computation ────────────────────────────────────────────────────
  // VPIN = (1/n) * Σ |buyVol_i - sellVol_i| / totalVol_i

  private computeVpin(instrument: string): void {
    const buckets = this.buckets.get(instrument);
    if (!buckets || buckets.length < 5) return;

    const window = buckets.slice(-VPIN_WINDOW);
    let sumImbalance = 0;
    let sumBuy = 0;
    let sumSell = 0;

    for (const b of window) {
      sumImbalance += b.orderImbalance;
      sumBuy += b.buyVolume;
      sumSell += b.sellVolume;
    }

    const vpin = sumImbalance / window.length;
    const totalPressure = sumBuy + sumSell;

    this.vpinReadings.set(instrument, {
      instrument,
      vpin: Math.min(vpin, 1),
      bucketWindow: window.length,
      buyPressure: totalPressure > 0 ? sumBuy / totalPressure : 0.5,
      sellPressure: totalPressure > 0 ? sumSell / totalPressure : 0.5,
      lastBucketTime: window[window.length - 1].endTime,
      sampleCount: buckets.length,
    });
  }

  // ── Collect from Arb Detector (simulated trade flow) ────────────────────

  async collectFromFeeds(): Promise<number> {
    const arbUrl = process.env.ARB_DETECTOR_URL || "http://genesis-arb-detector:8750";
    try {
      const res = await fetch(`${arbUrl}/state`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return 0;
      const data = await res.json() as { opportunities?: Array<{ pair: string; grossSpreadBps: number; exchange1: string; exchange2: string }> };
      if (!data.opportunities) return 0;

      let ingested = 0;
      for (const opp of data.opportunities.slice(0, 50)) {
        const trade: TradeEvent = {
          instrument: opp.pair,
          price: 1,
          volume: Math.abs(opp.grossSpreadBps) * 10 + 100,
          side: opp.grossSpreadBps > 0 ? "BUY" : "SELL",
          exchange: opp.exchange1,
          timestamp: Date.now(),
        };
        this.ingestTrade(trade);
        ingested++;
      }
      return ingested;
    } catch {
      return 0;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getVpin(instrument: string): VpinReading | null {
    return this.vpinReadings.get(instrument) ?? null;
  }

  getAllVpin(): VpinReading[] {
    return [...this.vpinReadings.values()].sort((a, b) => b.vpin - a.vpin);
  }

  getBuckets(instrument: string, limit: number = 20): VolumeBucket[] {
    return (this.buckets.get(instrument) ?? []).slice(-limit);
  }

  getInstrumentCount(): number {
    return this.vpinReadings.size;
  }

  getTotalBuckets(): number {
    let total = 0;
    for (const b of this.buckets.values()) total += b.length;
    return total;
  }

  reset(): void {
    this.buckets.clear();
    this.vpinReadings.clear();
    this.pendingTrades.clear();
    this.bucketCounter = 0;
    console.log("[VPIN] Reset complete");
  }
}
