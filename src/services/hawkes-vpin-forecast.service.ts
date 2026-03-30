// ─── Hawkes-VPIN Forecast Service — Forward VPIN via Multivariate Hawkes ─────
// lambda_i(t) = mu_i + SUM_j integral alpha_{ij} exp(-beta_{ij}(t-s)) dN_j(s)
// Horizon Delta = 45s
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Hawkes (1971), Easley et al. (2012) VPIN
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";

interface HawkesEvent {
  venue: number;   // 0=Binance, 1=OKX, 2=Bybit
  time: number;    // epoch ms
}

interface VpinForecast {
  venue: string;
  currentIntensity: number;
  forecastVpin: number;
  horizon: number;
  regime: RegimeType;
  confidence: number;
  timestamp: number;
}

// ── Calibrated background rates per venue per regime ──
const MU: Record<RegimeType, number[]> = {
  QUIET: [0.0041, 0.0037, 0.0029],
  TOXIC: [0.011, 0.0098, 0.0072],
  BURST: [0.026, 0.023, 0.018],
};

// ── Cross-excitation matrix alpha (3x3) ──
const ALPHA: number[][] = [
  [0.41, 0.29, 0.11],
  [0.26, 0.48, 0.14],
  [0.09, 0.13, 0.37],
];

// ── Decay matrix beta (3x3) ──
const BETA: number[][] = [
  [0.61, 0.54, 0.48],
  [0.57, 0.62, 0.51],
  [0.49, 0.46, 0.59],
];

const VENUES = ["BINANCE", "OKX", "BYBIT"];
const HORIZON_MS = 45_000;
const MAX_EVENTS = 5000;
const MAX_FORECASTS = 2000;

export class HawkesVpinForecastService {
  private events: HawkesEvent[] = [];
  private forecasts: VpinForecast[] = [];
  private currentRegime: RegimeType = "QUIET";
  private intensities: number[] = [0, 0, 0];
  private totalForecasts = 0;

  // ── Core: Compute conditional intensity for venue i ──
  computeIntensity(venueIdx: number, now: number): number {
    const mu = MU[this.currentRegime];
    let intensity = mu[venueIdx];

    for (const evt of this.events) {
      const dt = (now - evt.time) / 1000; // seconds
      if (dt <= 0 || dt > 120) continue; // skip future or very old events
      const j = evt.venue;
      intensity += ALPHA[venueIdx][j] * Math.exp(-BETA[venueIdx][j] * dt);
    }

    return intensity;
  }

  // ── Forecast VPIN at horizon ──
  forecast(): VpinForecast[] {
    const now = Date.now();
    const results: VpinForecast[] = [];

    for (let i = 0; i < VENUES.length; i++) {
      const currentLambda = this.computeIntensity(i, now);
      this.intensities[i] = currentLambda;

      // Forward VPIN: integrate expected intensity over horizon
      // Simplified: lambda_forecast = mu + (lambda_now - mu) * (1 - exp(-beta_avg * horizon)) / (beta_avg * horizon)
      const mu = MU[this.currentRegime][i];
      const betaAvg = BETA[i].reduce((a, b) => a + b, 0) / BETA[i].length;
      const horizonSec = HORIZON_MS / 1000;
      const decayFactor = (1 - Math.exp(-betaAvg * horizonSec)) / (betaAvg * horizonSec);
      const forecastLambda = mu + (currentLambda - mu) * decayFactor;

      // Map intensity to VPIN scale (0-1)
      const forecastVpin = Math.min(1, forecastLambda / (MU.BURST[i] * 2));

      const confidence = Math.min(0.95, 0.5 + this.events.length / 500);

      results.push({
        venue: VENUES[i],
        currentIntensity: currentLambda,
        forecastVpin,
        horizon: HORIZON_MS,
        regime: this.currentRegime,
        confidence,
        timestamp: now,
      });
    }

    this.forecasts.push(...results);
    this.totalForecasts += results.length;
    if (this.forecasts.length > MAX_FORECASTS) {
      this.forecasts = this.forecasts.slice(-MAX_FORECASTS);
    }

    return results;
  }

  // ── Ingest event ──
  addEvent(venueIdx: number, time?: number): void {
    this.events.push({ venue: venueIdx, time: time ?? Date.now() });
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  // ── Regime ──
  setRegime(regime: RegimeType): void {
    if (this.currentRegime !== regime) {
      console.log(`[HAWKES-VPIN] Regime switch: ${this.currentRegime} -> ${regime}`);
      this.currentRegime = regime;
    }
  }

  // ── Queries ──
  getForecasts(limit: number = 9): VpinForecast[] {
    return this.forecasts.slice(-limit);
  }

  getIntensities(): { venue: string; intensity: number }[] {
    return VENUES.map((v, i) => ({ venue: v, intensity: this.intensities[i] }));
  }

  getState(): Record<string, unknown> {
    return {
      currentRegime: this.currentRegime,
      intensities: VENUES.map((v, i) => ({ venue: v, intensity: this.intensities[i] })),
      mu: MU[this.currentRegime],
      eventCount: this.events.length,
      totalForecasts: this.totalForecasts,
      horizon: HORIZON_MS,
      recentForecasts: this.forecasts.slice(-9),
      alpha: ALPHA,
      beta: BETA,
    };
  }

  reset(): void {
    this.events = [];
    this.forecasts = [];
    this.intensities = [0, 0, 0];
    this.totalForecasts = 0;
    this.currentRegime = "QUIET";
    console.log("[HAWKES-VPIN] Reset complete");
  }
}
