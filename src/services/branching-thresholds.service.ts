// ─── Branching Thresholds Service — Per-Weapon Per-Regime Univariate n + ρ(N) ──
// BTC alert [0.81,0.96,1.12], critical [0.94,1.07,1.29]
// ETH alert [0.79,0.94,1.08], critical [0.91,1.04,1.22]
// Cascade Defence at critical: morph, 80:1 decoys, Kelly cap 0.35×, UKF conservative
// Spark #007 v9.2 Bonus Calibration — GCHQ lens (2026-03-30)
// Academic: Hawkes (1971), Bremaud & Massoulie (1996) stability of Hawkes processes
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";
export type InstrumentType = "BTC" | "ETH";

interface ThresholdSet {
  alert: [number, number, number];    // [quiet, toxic, burst]
  critical: [number, number, number]; // [quiet, toxic, burst]
}

interface CascadeDefence {
  morph: boolean;
  decoyRatio: number;    // 80:1
  kellyCapMultiplier: number; // 0.35×
  ukfConservative: boolean;
}

interface BranchingAssessment {
  instrument: InstrumentType;
  regime: RegimeType;
  spectralRadius: number;
  univariateN: number[];       // per-venue n values
  alertThreshold: number;
  criticalThreshold: number;
  status: "STABLE" | "ALERT" | "CRITICAL";
  cascadeDefenceActive: boolean;
  cascadeDefence: CascadeDefence | null;
  timestamp: number;
}

// ── Instrument-specific ρ(N) thresholds ──
const THRESHOLDS: Record<InstrumentType, ThresholdSet> = {
  BTC: {
    alert:    [0.81, 0.96, 1.12],
    critical: [0.94, 1.07, 1.29],
  },
  ETH: {
    alert:    [0.79, 0.94, 1.08],
    critical: [0.91, 1.04, 1.22],
  },
};

// ── Regime index mapping ──
const REGIME_IDX: Record<RegimeType, number> = {
  QUIET: 0,
  TOXIC: 1,
  BURST: 2,
};

// ── Cascade Defence parameters (activated at critical) ──
const CASCADE_DEFENCE: CascadeDefence = {
  morph: true,
  decoyRatio: 80,           // 80:1 decoys
  kellyCapMultiplier: 0.35, // Kelly cap reduced to 0.35×
  ukfConservative: true,
};

const MAX_ASSESSMENTS = 2000;

export class BranchingThresholdsService {
  private assessments: BranchingAssessment[] = [];
  private totalAssessments = 0;
  private alertCount = 0;
  private criticalCount = 0;
  private cascadeDefenceActivations = 0;

  // ── Core: Assess branching stability ──
  assess(
    instrument: InstrumentType,
    regime: RegimeType,
    spectralRadius: number,
    univariateN: number[],
  ): BranchingAssessment {
    const regimeIdx = REGIME_IDX[regime];
    const thresholds = THRESHOLDS[instrument];
    const alertThreshold = thresholds.alert[regimeIdx];
    const criticalThreshold = thresholds.critical[regimeIdx];

    let status: "STABLE" | "ALERT" | "CRITICAL" = "STABLE";
    let cascadeDefenceActive = false;
    let cascadeDefence: CascadeDefence | null = null;

    if (spectralRadius >= criticalThreshold) {
      status = "CRITICAL";
      cascadeDefenceActive = true;
      cascadeDefence = { ...CASCADE_DEFENCE };
      this.criticalCount++;
      this.cascadeDefenceActivations++;
      console.log(`[BRANCHING] CRITICAL ${instrument} ρ(N)=${spectralRadius.toFixed(4)} >= ${criticalThreshold} — CASCADE DEFENCE ACTIVE`);
    } else if (spectralRadius >= alertThreshold) {
      status = "ALERT";
      this.alertCount++;
      console.log(`[BRANCHING] ALERT ${instrument} ρ(N)=${spectralRadius.toFixed(4)} >= ${alertThreshold}`);
    }

    const assessment: BranchingAssessment = {
      instrument,
      regime,
      spectralRadius,
      univariateN,
      alertThreshold,
      criticalThreshold,
      status,
      cascadeDefenceActive,
      cascadeDefence,
      timestamp: Date.now(),
    };

    this.assessments.push(assessment);
    this.totalAssessments++;
    if (this.assessments.length > MAX_ASSESSMENTS) {
      this.assessments = this.assessments.slice(-MAX_ASSESSMENTS);
    }

    return assessment;
  }

  // ── Get latest assessment per instrument ──
  getLatest(instrument: InstrumentType): BranchingAssessment | null {
    for (let i = this.assessments.length - 1; i >= 0; i--) {
      if (this.assessments[i].instrument === instrument) return this.assessments[i];
    }
    return null;
  }

  // ── Queries ──
  getRecent(limit: number = 20): BranchingAssessment[] {
    return this.assessments.slice(-limit);
  }

  getState(): Record<string, unknown> {
    return {
      thresholds: THRESHOLDS,
      cascadeDefenceParams: CASCADE_DEFENCE,
      totalAssessments: this.totalAssessments,
      alertCount: this.alertCount,
      criticalCount: this.criticalCount,
      cascadeDefenceActivations: this.cascadeDefenceActivations,
      latestBTC: this.getLatest("BTC"),
      latestETH: this.getLatest("ETH"),
      recentAssessments: this.assessments.slice(-10),
    };
  }

  reset(): void {
    this.assessments = [];
    this.totalAssessments = 0;
    this.alertCount = 0;
    this.criticalCount = 0;
    this.cascadeDefenceActivations = 0;
    console.log("[BRANCHING] Reset complete");
  }
}
