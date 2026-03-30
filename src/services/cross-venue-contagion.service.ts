// ─── Cross-Venue Contagion Service — 3x3 Excitation Matrix + Regime Scaling ──
// Kernel: phi_{ij}(tau) = a_{ij} * exp(-tau / tau_{ij})
// Regime scaling: QUIET=1.0, TOXIC=1.4, BURST=2.1
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Hawkes (1971), Bacry et al. (2015) cross-excitation
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";

interface ContagionEvent {
  sourceVenue: number;
  targetVenue: number;
  excitation: number;
  kernel: number;
  timestamp: number;
}

interface ContagionState {
  excitationMatrix: number[][];
  effectiveMatrix: number[][];
  regime: RegimeType;
  regimeScaling: number;
  totalContagions: number;
  recentEvents: ContagionEvent[];
}

// ── Calibrated excitation matrix A (3x3) ──
const A: number[][] = [
  [0.41, 0.29, 0.11],
  [0.26, 0.48, 0.14],
  [0.09, 0.13, 0.37],
];

// ── Calibrated decay matrix beta (3x3) — time constants in seconds ──
const BETA: number[][] = [
  [0.61, 0.54, 0.48],
  [0.57, 0.62, 0.51],
  [0.49, 0.46, 0.59],
];

// ── Regime scaling factors ──
const REGIME_SCALING: Record<RegimeType, number> = {
  QUIET: 1.0,
  TOXIC: 1.4,
  BURST: 2.1,
};

const VENUES = ["BINANCE", "OKX", "BYBIT"];
const MAX_EVENTS = 3000;

export class CrossVenueContagionService {
  private currentRegime: RegimeType = "QUIET";
  private events: ContagionEvent[] = [];
  private effectiveMatrix: number[][] = A.map((row) => [...row]);
  private totalContagions = 0;

  constructor() {
    this.updateEffectiveMatrix();
  }

  // ── Update effective matrix with regime scaling ──
  private updateEffectiveMatrix(): void {
    const scale = REGIME_SCALING[this.currentRegime];
    this.effectiveMatrix = A.map((row) => row.map((v) => v * scale));
  }

  // ── Compute kernel value phi_{ij}(tau) ──
  computeKernel(sourceVenue: number, targetVenue: number, tauSeconds: number): number {
    const scale = REGIME_SCALING[this.currentRegime];
    const a = A[targetVenue][sourceVenue] * scale;
    const beta = BETA[targetVenue][sourceVenue];
    return a * Math.exp(-tauSeconds * beta);
  }

  // ── Process a contagion event ──
  processEvent(sourceVenue: number, targetVenue: number, tauSeconds: number): ContagionEvent {
    const kernel = this.computeKernel(sourceVenue, targetVenue, tauSeconds);
    const excitation = this.effectiveMatrix[targetVenue][sourceVenue];

    const evt: ContagionEvent = {
      sourceVenue,
      targetVenue,
      excitation,
      kernel,
      timestamp: Date.now(),
    };

    this.events.push(evt);
    this.totalContagions++;
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    return evt;
  }

  // ── Compute total excitation on venue i from all recent events ──
  computeTotalExcitation(venueIdx: number): number {
    const now = Date.now();
    let total = 0;

    for (const evt of this.events) {
      if (evt.targetVenue !== venueIdx) continue;
      const tauSeconds = (now - evt.timestamp) / 1000;
      if (tauSeconds > 120) continue;
      total += this.computeKernel(evt.sourceVenue, venueIdx, tauSeconds);
    }

    return total;
  }

  // ── Regime ──
  setRegime(regime: RegimeType): void {
    if (this.currentRegime !== regime) {
      console.log(`[CONTAGION] Regime switch: ${this.currentRegime} -> ${regime} (scaling: ${REGIME_SCALING[regime]})`);
      this.currentRegime = regime;
      this.updateEffectiveMatrix();
    }
  }

  // ── Queries ──
  getMatrix(): { base: number[][]; effective: number[][]; regime: RegimeType; scaling: number } {
    return {
      base: A,
      effective: this.effectiveMatrix,
      regime: this.currentRegime,
      scaling: REGIME_SCALING[this.currentRegime],
    };
  }

  getState(): Record<string, unknown> {
    const excitationPerVenue = VENUES.map((v, i) => ({
      venue: v,
      totalExcitation: this.computeTotalExcitation(i),
    }));

    return {
      regime: this.currentRegime,
      regimeScaling: REGIME_SCALING[this.currentRegime],
      baseMatrix: A,
      effectiveMatrix: this.effectiveMatrix,
      decayMatrix: BETA,
      venues: VENUES,
      excitationPerVenue,
      totalContagions: this.totalContagions,
      eventCount: this.events.length,
      recentEvents: this.events.slice(-10),
    };
  }

  reset(): void {
    this.events = [];
    this.totalContagions = 0;
    this.currentRegime = "QUIET";
    this.updateEffectiveMatrix();
    console.log("[CONTAGION] Reset complete");
  }
}
