// ─── Bayesian BVC Service — Bulk Volume Classification replacing Lee-Ready ──
// P(buy|Dp) = Phi((eta0 + eta1*Dp + eta2*spread + eta3*imbalance) / sigma)
// Calibrated eta = [0.12, 1.84, -0.67, 0.91]
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Easley et al. (2012) BVC, Lee & Ready (1991) tick rule
// ─────────────────────────────────────────────────────────────────────────────

interface BvcInput {
  instrument: string;
  deltaPrice: number;    // price change
  spread: number;        // bid-ask spread
  imbalance: number;     // order imbalance
}

interface BvcOutput {
  instrument: string;
  pBuy: number;          // P(buy | features)
  classification: "BUY" | "SELL" | "UNCERTAIN";
  confidence: number;
  features: { deltaPrice: number; spread: number; imbalance: number };
  eta: number[];
  sigma: number;
  timestamp: number;
}

// ── Calibrated coefficients ──
const ETA = [0.12, 1.84, -0.67, 0.91];
const SIGMA = 1.0;
const CONFIDENCE_THRESHOLD = 0.6;

const MAX_OUTPUTS = 2000;

// ── Standard normal CDF approximation (Abramowitz & Stegun) ──
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

export class BayesianBvcService {
  private outputs: BvcOutput[] = [];
  private eta: number[] = [...ETA];
  private sigma: number = SIGMA;
  private totalClassifications = 0;
  private buyCount = 0;
  private sellCount = 0;
  private uncertainCount = 0;

  // ── Core: Classify trade direction ──
  classify(input: BvcInput): BvcOutput {
    const { deltaPrice, spread, imbalance } = input;

    // Linear combination: eta0 + eta1*Dp + eta2*spread + eta3*imbalance
    const z = (this.eta[0] + this.eta[1] * deltaPrice + this.eta[2] * spread + this.eta[3] * imbalance) / this.sigma;

    // P(buy) = Phi(z)
    const pBuy = normalCdf(z);

    let classification: "BUY" | "SELL" | "UNCERTAIN";
    let confidence: number;

    if (pBuy > CONFIDENCE_THRESHOLD) {
      classification = "BUY";
      confidence = pBuy;
    } else if (pBuy < (1 - CONFIDENCE_THRESHOLD)) {
      classification = "SELL";
      confidence = 1 - pBuy;
    } else {
      classification = "UNCERTAIN";
      confidence = 0.5;
    }

    const output: BvcOutput = {
      instrument: input.instrument,
      pBuy,
      classification,
      confidence,
      features: { deltaPrice, spread, imbalance },
      eta: this.eta,
      sigma: this.sigma,
      timestamp: Date.now(),
    };

    this.outputs.push(output);
    this.totalClassifications++;
    if (classification === "BUY") this.buyCount++;
    else if (classification === "SELL") this.sellCount++;
    else this.uncertainCount++;

    if (this.outputs.length > MAX_OUTPUTS) {
      this.outputs = this.outputs.slice(-MAX_OUTPUTS);
    }

    return output;
  }

  // ── Batch classify ──
  classifyBatch(inputs: BvcInput[]): BvcOutput[] {
    return inputs.map((i) => this.classify(i));
  }

  // ── Update coefficients (online Bayesian update) ──
  updateEta(newEta: number[]): void {
    if (newEta.length === 4) {
      this.eta = newEta;
      console.log(`[BVC] Eta updated: [${newEta.map((e) => e.toFixed(3)).join(", ")}]`);
    }
  }

  // ── Queries ──
  getRecent(limit: number = 20): BvcOutput[] {
    return this.outputs.slice(-limit);
  }

  getState(): Record<string, unknown> {
    return {
      eta: this.eta,
      sigma: this.sigma,
      totalClassifications: this.totalClassifications,
      buyCount: this.buyCount,
      sellCount: this.sellCount,
      uncertainCount: this.uncertainCount,
      buyRatio: this.totalClassifications > 0 ? this.buyCount / this.totalClassifications : 0,
      sellRatio: this.totalClassifications > 0 ? this.sellCount / this.totalClassifications : 0,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      recentOutputs: this.outputs.slice(-10),
    };
  }

  reset(): void {
    this.outputs = [];
    this.eta = [...ETA];
    this.sigma = SIGMA;
    this.totalClassifications = 0;
    this.buyCount = 0;
    this.sellCount = 0;
    this.uncertainCount = 0;
    console.log("[BVC] Reset complete");
  }
}
