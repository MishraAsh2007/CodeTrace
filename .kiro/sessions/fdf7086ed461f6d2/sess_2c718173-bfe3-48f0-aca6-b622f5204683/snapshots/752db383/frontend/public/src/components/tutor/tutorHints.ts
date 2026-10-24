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

    // ---- compile-time: lexer -------------------------------------------

    case "lex_unexpected_char":
      return {
        title: "Unexpected character",
        hints: [
          {
            label: LABELS.think,
            text: `The compiler hit a character it doesn't recognize${lineHint(
              err
            )}. Which symbol on that line isn't valid C?`,
          },
          {
            label: LABELS.fix,
            text: "Look for a stray symbol like @, $, or a smart quote. Did you mean an operator (e.g. && for 'and'), or is it a typo to delete?",
          },
        ],
      };

    case "lex_unterminated_string":
      return {
        title: "Unterminated string",
        hints: [
          {
            label: LABELS.think,
            text: "A string literal was opened with \" but never closed. Where does this string start, and where should its closing \" go?",
          },
          {
            label: LABELS.fix,
            text: "Add the missing closing double-quote. Watch for a line break inside the string or an escaped \\\" you didn't intend.",
          },
        ],
      };

    case "lex_unterminated_char":
      return {
        title: "Unterminated character literal",
        hints: [
          {
            label: LABELS.think,
            text: "A character literal uses single quotes around exactly one character, like 'a'. Is one of your quotes missing or misplaced?",
          },
          {
            label: LABELS.fix,
            text: "Close the literal with a matching '. For a whole word you want double quotes (a string), not single quotes.",
          },
        ],
      };

    case "lex_invalid_number":
      return {
        title: "Invalid number literal",
        hints: [
          {
            label: LABELS.think,
            text: "A numeric literal isn't well-formed. Does it have more than one decimal point, or letters mixed into the digits?",
          },
          {
            label: LABELS.fix,
            text: "Write the number with at most one '.', and no stray characters (e.g. 3.14, not 3.1.4 or 3x).",
          },
        ],
      };

    // ---- compile-time: parser ------------------------------------------

    case "parse_missing_semicolon":
      return {
        title: "Missing semicolon",
        hints: [
          {
            label: LABELS.think,
            text: `Look at the underlined line${lineHint(
              err
            )}: the compiler expected a semicolon there but found something else. In C, how must every statement end?`,
          },
          {
            label: LABELS.fix,
            text: "Add a ';' at the end of the previous statement — the error usually points at the start of the line *after* the one missing its semicolon.",
          },
        ],
      };

    case "parse_missing_rparen":
    case "parse_missing_lparen":
      return {
        title: "Unbalanced parentheses",
        hints: [
          {
            label: LABELS.think,
            text: "A '(' and ')' don't pair up here. Count the opening and closing parentheses on this line — do they match?",
          },
          {
            label: LABELS.fix,
            text: "Add the missing parenthesis. Conditions like if (...) and while (...) and function calls each need a balanced pair.",
          },
        ],
      };

    case "parse_missing_rbrace":
    case "parse_missing_lbrace":
      return {
        title: "Unbalanced braces",
        hints: [
          {
            label: LABELS.think,
            text: "A '{' and '}' don't pair up. Which block (function body, loop, or if) was opened but not closed — or closed without being opened?",
          },
          {
            label: LABELS.fix,
            text: "Match every '{' with a '}'. Consistent indentation makes a missing brace much easier to spot.",
          },
        ],
      };

    case "parse_missing_rbracket":
      return {
        title: "Unbalanced brackets",
        hints: [
          {
            label: LABELS.think,
            text: "A '[' was opened without a matching ']'. Where is the array index or size that isn't closed?",
          },
          {
            label: LABELS.fix,
            text: "Add the closing ']' after the index/size expression.",
          },
        ],
      };

    case "parse_expected_identifier":
      return {
        title: "Expected a name",
        hints: [
          {
            label: LABELS.think,
            text: "The compiler expected a name (an identifier) here but found something else. Is a variable or function name missing, or is a reserved keyword being used as a name?",
          },
          {
            label: LABELS.fix,
            text: "Provide a valid name (letters, digits, underscores; not starting with a digit) and avoid keywords like int, if, or return as names.",
          },
        ],
      };

    case "parse_expected_type":
      return {
        title: "Expected a type",
        hints: [
          {
            label: LABELS.think,
            text: "A declaration needs a type (like int, char, or double) here. What type should this variable or function have?",
          },
          {
            label: LABELS.fix,
            text: "Add the type before the name, e.g. `int count;` rather than `count;`.",
          },
        ],
      };

    case "parse_unexpected_in_expr":
      return {
        title: "Unexpected token in expression",
        hints: [
          {
            label: LABELS.think,
            text: "Something appears where a value or operand was expected. Is there a dangling operator, a doubled symbol, or a missing operand?",
          },
          {
            label: LABELS.fix,
            text: "Check the expression reads left-to-right as value, operator, value (e.g. a + b), with no stray or repeated operators.",
          },
        ],
      };

    case "lex_error":
    case "parse_error":
      return {
        title:
          kind === "lex_error" ? "Syntax error (tokenizing)" : "Syntax error",
        hints: [
          {
            label: LABELS.think,
            text: `The compiler couldn't make sense of the code${lineHint(
              err
            )}. Read that line carefully — what's slightly off from valid C syntax?`,
          },
        ],
      };

    // Non-coached kinds (e.g. unsupported language): stay quiet.
    default:
      return null;
  }
}

/** A short " on line N" suffix when the error carries a line number. */
function lineHint(err: ApiError): string {
  return err.line !== undefined ? ` on line ${err.line}` : "";
}
