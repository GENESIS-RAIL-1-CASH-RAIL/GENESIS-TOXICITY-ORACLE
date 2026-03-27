// ─── Advisory Emitter Service — Kelly Adjustment Broadcast ──────────────────

import { ToxicityAssessment, ToxicityLevel, KellyAdjustment, AdvisoryAction } from "../types";

const MAX_ADJUSTMENTS = 2000;

interface BroadcastTarget {
  url: string;
  endpoint: string;
  label: string;
}

export class AdvisoryEmitterService {
  private adjustments: KellyAdjustment[] = [];
  private adjustmentCounter = 0;
  private targets: BroadcastTarget[];

  constructor() {
    this.targets = [
      { url: process.env.TPO_URL || "http://genesis-trade-parameter-optimizer:8848", endpoint: "/config", label: "TPO" },
      { url: process.env.ADAPTIVE_CALIBRATOR_URL || "http://genesis-adaptive-calibrator:8760", endpoint: "/intel", label: "AC" },
      { url: process.env.REGIME_DETECTOR_URL || "http://genesis-regime-detector:8855", endpoint: "/intel", label: "RD" },
      { url: process.env.CIA_URL || "http://genesis-cia:8797", endpoint: "/intel", label: "CIA" },
      { url: process.env.WHITEBOARD_URL || "http://genesis-whiteboard:8710", endpoint: "/ingest", label: "WB" },
      { url: process.env.GTC_URL || "http://genesis-gtc:8650", endpoint: "/ingest", label: "GTC" },
    ];
  }

  // ── Generate Kelly Adjustments ──────────────────────────────────────────

  generateAdjustments(assessments: ToxicityAssessment[]): KellyAdjustment[] {
    const newAdj: KellyAdjustment[] = [];

    for (const a of assessments) {
      const { action, kellyReduction } = this.deriveAction(a.level, a.vpin, a.flashCrashRisk);
      if (action === "NORMAL") continue;

      const adj: KellyAdjustment = {
        adjustmentId: `KA-${++this.adjustmentCounter}`,
        instrument: a.instrument,
        action,
        toxicityLevel: a.level,
        kellyReduction,
        targetInstruments: [],
        emittedAt: Date.now(),
      };

      this.adjustments.push(adj);
      newAdj.push(adj);
    }

    if (this.adjustments.length > MAX_ADJUSTMENTS) {
      this.adjustments = this.adjustments.slice(-MAX_ADJUSTMENTS);
    }

    return newAdj;
  }

  // ── Action Derivation ───────────────────────────────────────────────────

  private deriveAction(level: ToxicityLevel, vpin: number, flashCrash: boolean): { action: AdvisoryAction; kellyReduction: number } {
    if (flashCrash) {
      return { action: "ROUTE_AWAY", kellyReduction: 0.9 };
    }
    if (level === "TOXIC" && vpin >= 0.9) {
      return { action: "ROUTE_AWAY", kellyReduction: 0.8 };
    }
    if (level === "TOXIC") {
      return { action: "REDUCE_SIZE", kellyReduction: 0.6 };
    }
    if (level === "ELEVATED") {
      return { action: "WIDEN_SPREAD", kellyReduction: 0.3 };
    }
    return { action: "NORMAL", kellyReduction: 0 };
  }

  // ── Broadcast ───────────────────────────────────────────────────────────

  async broadcastAdjustments(adjustments: KellyAdjustment[]): Promise<number> {
    if (adjustments.length === 0) return 0;

    const payload = {
      source: "TOXICITY_ORACLE",
      type: "KELLY_ADJUSTMENT",
      adjustments: adjustments.map((a) => ({
        instrument: a.instrument,
        action: a.action,
        kellyReduction: a.kellyReduction,
        toxicityLevel: a.toxicityLevel,
      })),
      timestamp: Date.now(),
    };

    const results = await Promise.allSettled(
      this.targets.map((t) => this.fire(t, payload))
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[ADVISORY] Broadcast ${adjustments.length} Kelly adjustments to ${ok}/${this.targets.length} targets`);
    return adjustments.length;
  }

  private async fire(target: BroadcastTarget, payload: object): Promise<void> {
    try {
      await fetch(`${target.url}${target.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* fire-and-forget */
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getRecent(limit: number = 50): KellyAdjustment[] {
    return this.adjustments.slice(-limit);
  }

  getActive(): KellyAdjustment[] {
    const cutoff = Date.now() - 300_000; // last 5 minutes
    return this.adjustments.filter((a) => a.emittedAt > cutoff);
  }

  getStats(): { totalEmitted: number; activeCount: number; targetCount: number } {
    return {
      totalEmitted: this.adjustments.length,
      activeCount: this.getActive().length,
      targetCount: this.targets.length,
    };
  }

  reset(): void {
    this.adjustments = [];
    this.adjustmentCounter = 0;
    console.log("[ADVISORY] Reset complete");
  }
}
