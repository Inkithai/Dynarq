// The owner's decisions on the reminders that need approval (part 2 of the task).
// The task only asks for the decisions to be kept while the app runs, so they
// live in memory and are lost when the app restarts.

export type Decision = "approved" | "rejected";

/** A decision that has already been recorded for an invoice. */
export class DuplicateDecisionError extends Error {
  constructor(
    readonly invoiceId: string,
    readonly existing: Decision,
  ) {
    super(`invoice ${invoiceId} has already been ${existing}`);
    this.name = "DuplicateDecisionError";
  }
}

export class DecisionStore {
  private readonly decisions = new Map<string, Decision>();

  /**
   * Record a decision for one invoice. A second decision for the same invoice
   * is refused, so a double click or a re-posted form cannot quietly change
   * what the owner decided.
   */
  record(invoiceId: string, decision: Decision): void {
    const existing = this.decisions.get(invoiceId);
    if (existing !== undefined) {
      throw new DuplicateDecisionError(invoiceId, existing);
    }
    this.decisions.set(invoiceId, decision);
  }

  decisionFor(invoiceId: string): Decision | undefined {
    return this.decisions.get(invoiceId);
  }

  /** The recorded decisions, keyed by invoice id. */
  get recorded(): ReadonlyMap<string, Decision> {
    return this.decisions;
  }
}

export function isDecision(value: unknown): value is Decision {
  return value === "approved" || value === "rejected";
}
