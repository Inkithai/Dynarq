// Errors that mean "this input cannot be used", as opposed to a bug in the code.
// They are kept in their own module so that the small, dependency-free helpers
// (dates, for example) can raise them without importing the rules engine.

/** The data the rules were given cannot be used: a bad date, a broken entry. */
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInputError";
  }
}

/** The message of anything thrown, for reporting to a person. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
