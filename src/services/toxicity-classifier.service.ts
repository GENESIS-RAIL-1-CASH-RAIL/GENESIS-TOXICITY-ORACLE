// ─── Toxicity Classifier Service — VPIN + Autocorrelation → Classification ──

import { VpinEngineService } from "./vpin-engine.service";
import { ToxicityLevel, ToxicityAssessment, ToxicityAlert, QuoteAutocorrelation } from "../types";

const MAX_ASSESSMENTS = 2000;
const MAX_ALERTS = 500;
const VPIN_TOXIC_THRESHOLD = 0.85;
const VPIN_ELEVATED_THRESHOLD = 0.65;
const AUTOCORR_THRESHOLD = 0.6;

export class ToxicityClassifierService {
  private assessments: ToxicityAssessment[] = [];
  private alerts: ToxicityAlert[] = [];
  private autocorrelations: Map<string, QuoteAutocorrelation> = new Map();
  private assessmentCounter = 0;
  private alertCounter = 0;
  private quoteHistory: Map<string, number[]> = new Map();

  constructor(private vpinEngine: VpinEngineService) {}

  // ── Quote Ingestion for Autocorrelation ─────────────────────────────────

  ingestQuote(instrument: string, midPrice: number): void {
    if (!this.quoteHistory.has(instrument)) this.quoteHistory.set(instrument, []);
    const history = this.quoteHistory.get(instrument)!;
    history.push(midPrice);
    if (history.length > 500) {
      this.quoteHistory.set(instrument, history.slice(-500));
    }
  }

  // ── Autocorrelation Computation ─────────────────────────────────────────

  private computeAutocorrelation(instrument: string, lagSamples: number = 5): number {
    const history = this.quoteHistory.get(instrument);
    if (!history || history.length < lagSamples + 20) return 0;

    const n = history.length;
    const recent = history.slice(-100);
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;

    let numerator = 0;
    let denominator = 0;

    for (let i = lagSamples; i < recent.length; i++) {
      const x = recent[i] - mean;
      const y = recent[i - lagSamples] - mean;
      numerator += x * y;
      denominator += x * x;
    }

    const autocorr = denominator > 0 ? numerator / denominator : 0;

    this.autocorrelations.set(instrument, {
      instrument,
      lagMs: lagSamples * 100, // approximate
      autocorrelation: Math.max(-1, Math.min(1, autocorr)),
      sampleCount: n,
    });

    return autocorr;
  }

  // ── Classify All Instruments ────────────────────────────────────────────

  classifyAll(): ToxicityAssessment[] {
    const readings = this.vpinEngine.getAllVpin();
    const newAssessments: ToxicityAssessment[] = [];

    for (const reading of readings) {
      const autocorr = this.computeAutocorrelation(reading.instrument);
      const absAutocorr = Math.abs(autocorr);

      let level: ToxicityLevel = "CLEAN";
      let flashCrashRisk = false;

      if (reading.vpin >= VPIN_TOXIC_THRESHOLD && absAutocorr >= AUTOCORR_THRESHOLD) {
        level = "TOXIC";
        flashCrashRisk = true;
      } else if (reading.vpin >= VPIN_TOXIC_THRESHOLD || absAutocorr >= AUTOCORR_THRESHOLD) {
        level = "TOXIC";
      } else if (reading.vpin >= VPIN_ELEVATED_THRESHOLD) {
        level = "ELEVATED";
      }

      const assessment: ToxicityAssessment = {
        assessmentId: `TA-${++this.assessmentCounter}`,
        instrument: reading.instrument,
        level,
        vpin: reading.vpin,
        autocorrelation: autocorr,
        vpinThreshold: VPIN_TOXIC_THRESHOLD,
        autocorrelationThreshold: AUTOCORR_THRESHOLD,
        flashCrashRisk,
        timestamp: Date.now(),
      };

      this.assessments.push(assessment);
      newAssessments.push(assessment);

      if (level === "TOXIC") {
        this.issueAlert(assessment);
      }
    }

    if (this.assessments.length > MAX_ASSESSMENTS) {
      this.assessments = this.assessments.slice(-MAX_ASSESSMENTS);
    }

    return newAssessments;
  }

  // ── Alert Issuance ──────────────────────────────────────────────────────

  private issueAlert(assessment: ToxicityAssessment): void {
    const existing = this.alerts.find(
      (a) => a.instrument === assessment.instrument && !a.resolvedAt
    );
    if (existing) return; // already alerted

    const alert: ToxicityAlert = {
      alertId: `TX-${++this.alertCounter}`,
      instrument: assessment.instrument,
      level: assessment.level,
      vpin: assessment.vpin,
      autocorrelation: assessment.autocorrelation,
      advisory: assessment.flashCrashRisk
        ? `FLASH CRASH RISK: ${assessment.instrument} VPIN=${assessment.vpin.toFixed(3)} autocorr=${assessment.autocorrelation.toFixed(3)}`
        : `TOXIC FLOW: ${assessment.instrument} VPIN=${assessment.vpin.toFixed(3)}`,
      issuedAt: Date.now(),
      resolvedAt: null,
    };

    this.alerts.push(alert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(-MAX_ALERTS);
    }

    console.log(`[TOXICITY] ⚠ ${alert.advisory}`);
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getCurrentAssessments(): ToxicityAssessment[] {
    const latest = new Map<string, ToxicityAssessment>();
    for (const a of this.assessments) {
      latest.set(a.instrument, a);
    }
    return [...latest.values()].sort((a, b) => b.vpin - a.vpin);
  }

  getActiveAlerts(): ToxicityAlert[] {
    return this.alerts.filter((a) => !a.resolvedAt);
  }

  getAllAlerts(limit: number = 50): ToxicityAlert[] {
    return this.alerts.slice(-limit);
  }

  getByInstrument(instrument: string): ToxicityAssessment[] {
    return this.assessments.filter((a) => a.instrument === instrument).slice(-20);
  }

  getStats(): { toxic: number; elevated: number; clean: number; alertsActive: number; totalAssessments: number } {
    const current = this.getCurrentAssessments();
    return {
      toxic: current.filter((a) => a.level === "TOXIC").length,
      elevated: current.filter((a) => a.level === "ELEVATED").length,
      clean: current.filter((a) => a.level === "CLEAN").length,
      alertsActive: this.getActiveAlerts().length,
      totalAssessments: this.assessments.length,
    };
  }

  reset(): void {
    this.assessments = [];
    this.alerts = [];
    this.autocorrelations.clear();
    this.quoteHistory.clear();
    this.assessmentCounter = 0;
    this.alertCounter = 0;
    console.log("[TOXICITY] Reset complete");
  }
}
