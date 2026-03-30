// ─── Instrument-Specific Hawkes Service — BTC vs ETH Excitation Matrices ──────
// BTC A=[[0.44,0.31,0.09],[0.27,0.52,0.12],[0.08,0.14,0.39]]
// ETH A=[[0.37,0.26,0.11],[0.24,0.44,0.15],[0.10,0.12,0.34]]
// Regime scaling: quiet×0.68, toxic×1.42, burst×2.15
// Separate N branching matrices for BTC and ETH
// Spark #007 v9.2 Bonus Calibration — GCHQ lens (2026-03-30)
// Academic: Hawkes (1971), Bacry et al. (2015), Embrechts et al. (2011) multivariate Hawkes
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";
export type InstrumentType = "BTC" | "ETH";

interface InstrumentHawkesState {
  instrument: InstrumentType;
  baseMatrix: number[][];
  effectiveMatrix: number[][];
  branchingMatrix: number[][];
  regime: RegimeType;
  regimeScaling: number;
  spectralRadius: number;
  totalEvents: number;
  recentEvents: InstrumentHawkesEvent[];
}

interface InstrumentHawkesEvent {
  instrument: InstrumentType;
  sourceVenue: number;
  targetVenue: number;
  excitation: number;
  regime: RegimeType;
  timestamp: number;
}

// ── BTC excitation matrix A ──
const A_BTC: number[][] = [
  [0.44, 0.31, 0.09],
  [0.27, 0.52, 0.12],
  [0.08, 0.14, 0.39],
];

// ── ETH excitation matrix A ──
const A_ETH: number[][] = [
  [0.37, 0.26, 0.11],
  [0.24, 0.44, 0.15],
  [0.10, 0.12, 0.34],
];

// ── BTC branching matrix N (mean number of offspring per event) ──
const N_BTC: number[][] = [
  [0.38, 0.27, 0.08],
  [0.23, 0.45, 0.10],
  [0.07, 0.12, 0.34],
];

// ── ETH branching matrix N ──
const N_ETH: number[][] = [
  [0.32, 0.22, 0.09],
  [0.20, 0.38, 0.13],
  [0.08, 0.10, 0.29],
];

// ── Regime scaling factors ──
const REGIME_SCALING: Record<RegimeType, number> = {
  QUIET: 0.68,
  TOXIC: 1.42,
  BURST: 2.15,
};

const INSTRUMENT_MATRICES: Record<InstrumentType, { A: number[][]; N: number[][] }> = {
  BTC: { A: A_BTC, N: N_BTC },
  ETH: { A: A_ETH, N: N_ETH },
};

const VENUES = ["BINANCE", "OKX", "BYBIT"];
const MAX_EVENTS = 3000;

export class InstrumentHawkesService {
  private currentRegime: RegimeType = "QUIET";
  private events: InstrumentHawkesEvent[] = [];
  private totalEvents = 0;

  // ── Compute effective matrix = A × regime_scaling ──
  private computeEffectiveMatrix(instrument: InstrumentType): number[][] {
    const { A } = INSTRUMENT_MATRICES[instrument];
    const scale = REGIME_SCALING[this.currentRegime];
    return A.map((row) => row.map((v) => v * scale));
  }

  // ── Compute effective branching matrix = N × regime_scaling ──
  private computeEffectiveBranching(instrument: InstrumentType): number[][] {
    const { N } = INSTRUMENT_MATRICES[instrument];
    const scale = REGIME_SCALING[this.currentRegime];
    return N.map((row) => row.map((v) => v * scale));
  }

  // ── Spectral radius via power iteration ──
  private computeSpectralRadius(matrix: number[][]): number {
    const n = matrix.length;
    let v = Array(n).fill(1 / Math.sqrt(n));
    let eigenvalue = 0;

    for (let iter = 0; iter < 50; iter++) {
      const w = Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          w[i] += matrix[i][j] * v[j];
        }
      }
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (norm < 1e-15) break;
      eigenvalue = norm;
      v = w.map((x) => x / norm);
    }

    return eigenvalue;
  }

  // ── Process event for an instrument ──
  processEvent(instrument: InstrumentType, sourceVenue: number, targetVenue: number): InstrumentHawkesEvent {
    const effective = this.computeEffectiveMatrix(instrument);
    const excitation = effective[targetVenue][sourceVenue];

    const evt: InstrumentHawkesEvent = {
      instrument,
      sourceVenue,
      targetVenue,
      excitation,
      regime: this.currentRegime,
      timestamp: Date.now(),
    };

    this.events.push(evt);
    this.totalEvents++;
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    return evt;
  }

  // ── Get full state for an instrument ──
  getInstrumentState(instrument: InstrumentType): InstrumentHawkesState {
    const effective = this.computeEffectiveMatrix(instrument);
    const branching = this.computeEffectiveBranching(instrument);
    const spectralRadius = this.computeSpectralRadius(branching);
    const instrumentEvents = this.events.filter((e) => e.instrument === instrument);

    return {
      instrument,
      baseMatrix: INSTRUMENT_MATRICES[instrument].A,
      effectiveMatrix: effective,
      branchingMatrix: branching,
      regime: this.currentRegime,
      regimeScaling: REGIME_SCALING[this.currentRegime],
      spectralRadius,
      totalEvents: instrumentEvents.length,
      recentEvents: instrumentEvents.slice(-10),
    };
  }

  // ── Regime ──
  setRegime(regime: RegimeType): void {
    if (this.currentRegime !== regime) {
      console.log(`[INSTRUMENT-HAWKES] Regime switch: ${this.currentRegime} -> ${regime} (scaling: ${REGIME_SCALING[regime]})`);
      this.currentRegime = regime;
    }
  }

  // ── Combined state (both instruments) ──
  getState(): Record<string, unknown> {
    const btcState = this.getInstrumentState("BTC");
    const ethState = this.getInstrumentState("ETH");

    return {
      regime: this.currentRegime,
      regimeScaling: REGIME_SCALING,
      venues: VENUES,
      btc: {
        baseMatrix: btcState.baseMatrix,
        effectiveMatrix: btcState.effectiveMatrix,
        branchingMatrix: btcState.branchingMatrix,
        spectralRadius: btcState.spectralRadius,
        totalEvents: btcState.totalEvents,
        recentEvents: btcState.recentEvents,
      },
      eth: {
        baseMatrix: ethState.baseMatrix,
        effectiveMatrix: ethState.effectiveMatrix,
        branchingMatrix: ethState.branchingMatrix,
        spectralRadius: ethState.spectralRadius,
        totalEvents: ethState.totalEvents,
        recentEvents: ethState.recentEvents,
      },
      totalEvents: this.totalEvents,
    };
  }

  reset(): void {
    this.events = [];
    this.totalEvents = 0;
    this.currentRegime = "QUIET";
    console.log("[INSTRUMENT-HAWKES] Reset complete");
  }
}
