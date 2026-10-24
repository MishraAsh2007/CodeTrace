// Turns a classified runtime error into a Socratic hint sequence.
//
// The backend tags each error with a machine-readable `kind` (see
// backend/src/c/mod.rs::classify_runtime). The tutor maps that kind to an
// ordered list of hints: the first nudges the learner toward the *cause* with
// a question, and later hints progressively point toward the *fix*. The UI
// reveals them one at a time so the learner thinks before seeing more.

import type { ApiError } from "../../api";

export interface TutorHint {
  /** Short label for the step, e.g. "Think about it" / "Getting warmer". */
  label: string;
  /** The question or hint text shown to the learner. */
  text: string;
}

export interface TutorContent {
  /** Plain-language name of what went wrong. */
  title: string;
  /** The ordered hint sequence (question first, fix last). */
  hints: TutorHint[];
}

/** Pull "index N out of bounds (len M)" numbers out of a message, if present. */
function parseBounds(message: string): { index?: number; len?: number } {
  const idx = message.match(/index (-?\d+)/);
  const len = message.match(/len (\d+)/);
  return {
    index: idx ? Number(idx[1]) : undefined,
    len: len ? Number(len[1]) : undefined,
  };
}

const LABELS = {
  think: "Think about it",
  warmer: "Getting warmer",
  fix: "Toward the fix",
} as const;

/**
 * Build the tutor hint sequence for an error. Returns null when the error is
 * one the tutor does not coach on (e.g. the language-not-implemented notice),
 * so the panel can stay quiet.
 */
export function hintsForError(err: ApiError): TutorContent | null {
  const kind = err.kind ?? "";

  switch (kind) {
    case "index_out_of_bounds": {
      const { index, len } = parseBounds(err.message);
      const range =
        len !== undefined ? `0 to ${len - 1}` : "0 to (length − 1)";
      const accessed =
        index !== undefined ? `index ${index}` : "the index you used";
      return {
        title: "Array index out of bounds",
        hints: [
          {
            label: LABELS.think,
            text: `An array of length ${
              len ?? "N"
            } has valid indices ${range}. Which index did your code try to read, and is it inside that range?`,
          },
          {
            label: LABELS.warmer,
            text: `You accessed ${accessed}, but the last valid index is ${
              len !== undefined ? len - 1 : "length − 1"
            }. Off-by-one slips often come from a loop condition using <= instead of <, or counting from 1 instead of 0.`,
          },
          {
            label: LABELS.fix,
            text: `Check the bound where this index is produced: should the loop stop at i < length (not i <= length)? Or should the index be adjusted so it never reaches ${
              len ?? "the length"
            }?`,
          },
        ],
      };
    }

    case "negative_index":
      return {
        title: "Negative array index",
        hints: [
          {
            label: LABELS.think,
            text: "Array indices start at 0 and go up. How did this index become negative?",
          },
          {
            label: LABELS.fix,
            text: "Trace the expression that computes the index. A subtraction that underflows (e.g. i - 1 when i is 0) is a common cause.",
          },
        ],
      };

    case "division_by_zero":
    case "modulo_by_zero": {
      const op = kind === "modulo_by_zero" ? "take the remainder with" : "divide by";
      return {
        title: kind === "modulo_by_zero" ? "Modulo by zero" : "Division by zero",
        hints: [
          {
            label: LABELS.think,
            text: `What was the value of the divisor at this point? What happens mathematically when you ${op} zero?`,
          },
          {
            label: LABELS.warmer,
            text: "Trace back where the divisor got its value. Was it never assigned, or did an earlier calculation make it zero?",
          },
          {
            label: LABELS.fix,
            text: "Guard the operation: check whether the divisor is zero before dividing, and decide what should happen in that case.",
          },
        ],
      };
    }

    case "null_deref":
      return {
        title: "Null pointer dereference",
        hints: [
          {
            label: LABELS.think,
            text: "This pointer was null (0) when your code tried to follow it. What was it supposed to point at by now?",
          },
          {
            label: LABELS.warmer,
            text: "Trace where this pointer is assigned. Was it ever set to a valid address, or did it stay null?",
          },
          {
            label: LABELS.fix,
            text: "Make sure the pointer is assigned a valid target before you dereference it with *, and consider checking it isn't null first.",
          },
        ],
      };

    case "undeclared_variable":
      return {
        title: "Undeclared variable",
        hints: [
          {
            label: LABELS.think,
            text: "This name is used before it's declared in this scope. Is it a typo, or declared somewhere the code can't see here?",
          },
          {
            label: LABELS.fix,
            text: "Declare the variable (with its type) before first use, and check it's in the same function/block.",
          },
        ],
      };

    case "stack_overflow":
      return {
        title: "Too much recursion",
        hints: [
          {
            label: LABELS.think,
            text: "A recursive call kept going without stopping. What is the base case that should end the recursion?",
          },
          {
            label: LABELS.fix,
            text: "Make sure every recursive path moves toward the base case and that the base case actually returns without recursing.",
          },
        ],
      };

    case "infinite_loop":
      return {
        title: "Possible infinite loop",
        hints: [
          {
            label: LABELS.think,
            text: "The program ran for a very long time. Which variable is the loop's condition watching, and does the loop body actually change it toward stopping?",
          },
          {
            label: LABELS.fix,
            text: "Check that the loop updates its condition variable each iteration and that the condition eventually becomes false.",
          },
        ],
      };

    case "no_main":
      return {
        title: "No main function",
        hints: [
          {
            label: LABELS.think,
            text: "A C program starts at main(). Is there a function named exactly `main`?",
          },
        ],
      };

    case "runtime_other":
      return {
        title: "Runtime error",
        hints: [
          {
            label: LABELS.think,
            text: "Step through the trace to the point where it stopped. What was the program trying to do there, and what value was unexpected?",
          },
        ],
      };

    // Compile-time and non-coached kinds: let the Problems panel handle them.
    default:
      return null;
  }
}
