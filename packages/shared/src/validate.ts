import { validateEstimateMin, validateStartDue } from "./dayBounds";
import { validateRecurrenceRule } from "./recurrence";

export const MAX_REMINDERS_PER_TASK = 10;
export const MIN_ESTIMATE_MIN = 1;
export const MAX_ESTIMATE_MIN = 1440;
export const MAX_RECURRENCE_COUNT = 1000;

export interface SchedulingInput {
  startAt?: Date | null;
  dueAt?: Date | null;
  estimateMin?: number | null;
  reminderCount?: number;
  rrule?: string | null;
  recurrenceMode?: "fixed" | "after_completion";
  recurrenceMaxCount?: number | null;
}

export interface SchedulingValidationError {
  field: "startAt" | "estimateMin" | "reminders" | "recurrence";
  message: string;
}

/**
 * Validates the scheduling slice of a task:
 * start <= due, estimate 1..1440, at most 10 reminders, repeat-rule limits.
 * Returns a list of errors (empty when valid).
 */
export function validateScheduling(input: SchedulingInput): SchedulingValidationError[] {
  const errors: SchedulingValidationError[] = [];

  const startDue = validateStartDue(input.startAt ?? null, input.dueAt ?? null);
  if (!startDue.valid) {
    errors.push({ field: "startAt", message: startDue.error! });
  }

  const estimate = validateEstimateMin(input.estimateMin ?? null);
  if (!estimate.valid) {
    errors.push({ field: "estimateMin", message: estimate.error! });
  }

  if (
    input.reminderCount !== undefined &&
    input.reminderCount !== null &&
    input.reminderCount > MAX_REMINDERS_PER_TASK
  ) {
    errors.push({
      field: "reminders",
      message: `A task can have at most ${MAX_REMINDERS_PER_TASK} reminders`,
    });
  }

  if (input.rrule) {
    const rule = validateRecurrenceRule(
      input.rrule,
      input.recurrenceMode ?? "fixed",
      input.recurrenceMaxCount ?? null
    );
    if (!rule.valid) {
      errors.push({ field: "recurrence", message: rule.error! });
    }
  }

  return errors;
}
