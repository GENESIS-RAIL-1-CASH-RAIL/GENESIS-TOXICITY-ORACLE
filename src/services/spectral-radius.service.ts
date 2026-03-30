// ─── Spectral Radius Service — Power Iteration Monitoring + Cascade Defence ──
// rho(A_eff) via power iteration (<3ms)
// Alert thresholds: quiet 0.79/0.91, toxic 0.94/1.02, burst 1.05/1.18
// Cascade defence at critical. Kelly reduction: exp(-2.1*(rho-0.9))
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Bremaud & Massoulie (1996) stability of Hawkes processes
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";
export type CascadeStatus = "STABLE" | "WARNING" | "CRITICAL" | "CASCADE";

interface SpectralState {
  spectralRadius: number;
  cascadeStatus: CascadeStatus;
  kellyReduction: number;
  regime: RegimeType;
  warningThreshold: number;
  criticalThreshold: number;
  iterations: number;
  computeTimeMs: number;
  timestamp: number;
}

// ── Alert thresholds per regime [warning, critical] ──
const THRESHOLDS: Record<RegimeType, [number, number]> = {
  QUIET: [0.79, 0.91],
  TOXIC: [0.94, 1.02],
  BURST: [1.05, 1.18],
};

// ── Regime scaling factors ──
const REGIME_SCALING: Record<RegimeType, number> = {
  QUIET: 1.0,
  TOXIC: 1.4,
  BURST: 2.1,
};

// ── Base excitation matrix (matches cross-venue-contagion) ──
const A_BASE: number[][] = [
  [0.41, 0.29, 0.11],
  [0.26, 0.48, 0.14],
  [0.09, 0.13, 0.37],
];

const MAX_ITERATIONS = 100;
const CONVERGENCE_TOL = 1e-8;
const MAX_HISTORY = 2000;
const KELLY_KAPPA = 2.1;
const KELLY_PIVOT = 0.9;

export class SpectralRadiusService {
  private currentRegime: RegimeType = "QUIET";
  private history: SpectralState[] = [];
  private lastState: SpectralState | null = null;

  // ── Core: Power iteration for spectral radius ──
  computeSpectralRadius(matrix?: number[][]): SpectralState {
    const startTime = performance.now();
    const scale = REGIME_SCALING[this.currentRegime];
    const A = matrix ?? A_BASE.map((row) => row.map((v) => v * scale));
    const n = A.length;

    // Initialise eigenvector
    let v = new Array(n).fill(1 / Math.sqrt(n));
    let eigenvalue = 0;

    let iterations = 0;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      iterations++;

      // Matrix-vector multiply: w = A * v
      const w = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          w[i] += A[i][j] * v[j];
        }
      }

      // Compute norm
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (norm < 1e-15) break;

      const newEigenvalue = norm;

      // Check convergence
      if (Math.abs(newEigenvalue - eigenvalue) < CONVERGENCE_TOL) {
        eigenvalue = newEigenvalue;
        break;
      }

      eigenvalue = newEigenvalue;
      v = w.map((x) => x / norm);
    }

    const computeTimeMs = performance.now() - startTime;
    const [warning, critical] = THRESHOLDS[this.currentRegime];

    // Determine cascade status
    let cascadeStatus: CascadeStatus;
    if (eigenvalue >= critical) {
      cascadeStatus = eigenvalue >= critical * 1.15 ? "CASCADE" : "CRITICAL";
    } else if (eigenvalue >= warning) {
      cascadeStatus = "WARNING";
    } else {
      cascadeStatus = "STABLE";
    }

    // Kelly reduction: exp(-2.1 * (rho - 0.9))
    const kellyReduction = eigenvalue > KELLY_PIVOT
      ? Math.exp(-KELLY_KAPPA * (eigenvalue - KELLY_PIVOT))
      : 1.0;

    const state: SpectralState = {
      spectralRadius: eigenvalue,
      cascadeStatus,
      kellyReduction,
      regime: this.currentRegime,
      warningThreshold: warning,
      criticalThreshold: critical,
      iterations,
      computeTimeMs,
      timestamp: Date.now(),
    };

    this.lastState = state;
    this.history.push(state);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    if (cascadeStatus === "CRITICAL" || cascadeStatus === "CASCADE") {
      console.log(`[SPECTRAL] ${cascadeStatus}: rho=${eigenvalue.toFixed(4)} Kelly=${kellyReduction.toFixed(4)} regime=${this.currentRegime}`);
    }

    return state;
  }

  // ── Regime ──
  setRegime(regime: RegimeType): void {
    if (this.currentRegime !== regime) {
      console.log(`[SPECTRAL] Regime switch: ${this.currentRegime} -> ${regime}`);
      this.currentRegime = regime;
    }
  }

  // ── Queries ──
  getLastState(): SpectralState | null {
    return this.lastState;
  }

  isCascadeRisk(): boolean {
    return this.lastState !== null && (this.lastState.cascadeStatus === "CRITICAL" || this.lastState.cascadeStatus === "CASCADE");
  }

  getKellyReduction(): number {
    return this.lastState?.kellyReduction ?? 1.0;
  }

  getState(): Record<string, unknown> {
    return {
      current: this.lastState,
      regime: this.currentRegime,
      thresholds: THRESHOLDS,
      regimeScaling: REGIME_SCALING,
      kellyKappa: KELLY_KAPPA,
      kellyPivot: KELLY_PIVOT,
      historyLength: this.history.length,
      recentHistory: this.history.slice(-10),
      cascadeRisk: this.isCascadeRisk(),
    };
  }

  reset(): void {
    this.history = [];
    this.lastState = null;
    this.currentRegime = "QUIET";
    console.log("[SPECTRAL] Reset complete");
  }
}
