// bugs.ts: questions about the bug a run actually hit (exceptions, syntax errors, endless runs).

import type { Encoded, TraceStep } from "../../types";
import { isRef, liveFrames, primitiveText, same } from "../../viz/model";
import {
  CHAIN,
  IDENT,
  PY_WORDS,
  asNumber,
  choices,
  code,
  currentFrame,
  defLine,
  describe,
  editDistance,
  enclosingWhile,
  evalChain,
  evalIndex,
  frameId,
  frameName,
  heapOf,
  lengthOf,
  lookup,
  make,
  returnsValue,
  textAt,
  type Ctx,
  type Question,
} from "../core";

// ---------------------------------------------------------------------------
// Runtime exceptions
// ---------------------------------------------------------------------------

export function errorQuestions(ctx: Ctx): Question[] {
  const { result } = ctx;
  if (result.status !== "error" || result.error_step == null) return [];
  const i = result.error_step;
  const step = ctx.trace[i];
  const msg = step.exception_msg ?? result.message ?? "";
  const line = step.line;
  const text = textAt(ctx, line);
  const where = `Line ${line} (${code(text)}) raised ${code(msg)}.`;
  const specific = specificError(ctx, i, msg, line, text, where);
  return specific.length ? specific : genericError(ctx, i, msg, where);
}

function specificError(ctx: Ctx, i: number, msg: string, line: number, text: string, where: string): Question[] {
  const step = ctx.trace[i];

  const noneAttr = msg.match(/'NoneType' object has no attribute '(\w+)'/);
  if (noneAttr) return noneAttributeQuestions(ctx, i, noneAttr[1], where);

  const badMethod = msg.match(/^AttributeError: '(list|str|dict|set|tuple|int|float)' object has no attribute '(\w+)'/);
  if (badMethod) return wrongMethodQuestions(ctx, i, badMethod[1], badMethod[2], where);

  if (/^IndexError: .*index out of range/.test(msg)) return indexQuestions(ctx, i, where);

  if (/^ZeroDivisionError/.test(msg)) return zeroDivisionQuestions(ctx, i, where);

  const keyErr = msg.match(/^KeyError: (.+)$/);
  if (keyErr) return keyErrorQuestions(ctx, i, keyErr[1], where);

  const unbound = msg.match(/^UnboundLocalError: (?:cannot access local variable|local variable) '(\w+)'/);
  if (unbound) return unboundLocalQuestions(ctx, i, unbound[1], where);

  const missingArg = msg.match(/^TypeError: (?:(\w+)\.)?(\w+)\(\) missing (\d+) required positional arguments?: (.+)$/);
  if (missingArg) {
    const [, owner, fn, count, names] = missingArg;
    const isMethod = !!owner;
    return [
      make(
        {
          id: "missing-argument",
          kind: "explain",
          group: "bug",
          concept: "arguments",
          title: "Count the arguments",
          context: where,
          prompt: `Why did the call to ${code(`${fn}()`)} fail?`,
          explanation:
            `${code(fn)} declares a parameter for ${names}, but the call on line ${line} didn't pass a value for it. Python doesn't fill in missing arguments.` +
            (isMethod ? ` For a method, ${code("self")} is filled in automatically; every other parameter needs an argument.` : ""),
          hints: [`Compare the ${code("def")} line of ${code(fn)} with the call on line ${line}.`],
          step: i,
          focusLine: line,
        },
        [
          `The call passed too few arguments: ${count === "1" ? `nothing was given for ${names}` : `${count} parameters (${names}) got no value`}`,
          "Python fills missing arguments with None, but None isn't allowed here",
          isMethod ? `Methods can't be called on objects created with ${code(`${owner}()`)}` : "Functions can only be called once",
        ],
        0,
      ),
    ];
  }

  if (/^TypeError: 'str' object does not support item assignment/.test(msg)) {
    const out: Question[] = [
      make(
        {
          id: "str-immutable",
          kind: "explain",
          group: "bug",
          concept: "string-immutable",
          title: "Can a string change?",
          context: where,
          prompt: "Why can't line " + line + " change one character of the string?",
          explanation: "Python strings are immutable: once created, their characters can't be changed. Build a new string instead (with slicing, +, or `.replace`) and assign it back.",
          hints: ["Try the same assignment on a list. What's different about strings?"],
          step: i,
          focusLine: line,
        },
        ["Strings are immutable, so you build a new string instead", "String indices start at 1, so index 0 doesn't exist", "Only strings of length 1 can be changed"],
        0,
      ),
    ];
    const m = text.match(new RegExp(`^(${IDENT})\\[(.+)\\]\\s*=\\s*(.+)$`));
    if (m) {
      const [, s, idx, value] = m;
      const n = /^\d+$/.test(idx.trim()) ? Number(idx) : null;
      const after = n !== null ? `${n + 1}` : `${idx} + 1`;
      out.push(
        make(
          {
            id: "str-immutable-repair",
            kind: "repair",
            group: "bug",
            concept: "string-immutable",
            title: "Choose the repair",
            context: `Line ${line} reads ${code(text)}.`,
            prompt: `Which line gives ${code(s)} the new character at index ${idx}?`,
            explanation: `${code(`${s}[:${idx}] + ${value} + ${s}[${after}:]`)} builds a new string from the part before, the new character, and the part after, then assigns it back to ${code(s)}. ${code(".replace")} returns a new string but doesn't change ${code(s)} unless you assign it.`,
            hints: ["You can't change the old string, but you can build a new one.", "Which slices give the parts before and after the index?"],
            step: i,
            focusLine: line,
            edit: { mode: "replace", line },
          },
          [
            code(`${s} = ${s}[:${idx}] + ${value} + ${s}[${after}:]`),
            code(`${s}.replace(${s}[${idx}], ${value})`),
            code(`${s}[${idx}:${after}] = ${value}`),
          ],
          0,
        ),
      );
    }
    return out;
  }

  const notIterable = msg.match(/^TypeError: '(int|float)' object is not iterable/);
  if (notIterable) {
    const out: Question[] = [];
    const m = text.match(new RegExp(`^for\\s+(${IDENT})\\s+in\\s+(${IDENT}):$`));
    const n = m ? lookup(step, m[2]) : undefined;
    out.push(
      make(
        {
          id: "not-iterable",
          kind: "explain",
          group: "bug",
          concept: "loops",
          title: "What can a for loop go over?",
          context: where + (m && n !== undefined ? ` ${code(m[2])} was ${primitiveText(n)}.` : ""),
          prompt: `What does ${code("for ... in")} need after ${code("in")}?`,
          explanation: `A for loop goes over something iterable: a list, a string, a range, a dict. A single number isn't a sequence; ${code("range(n)")} turns it into 0, 1, …, n − 1.`,
          hints: ["Is a number a collection of items?"],
          step: i,
          focusLine: line,
        },
        [`Something iterable, like a list or ${code("range(n)")}, not a single number`, "Any value works; the error is about the loop variable's name", "A string version of the number"],
        0,
      ),
    );
    if (m && typeof n === "number") {
      const [, v, name] = m;
      out.push(
        make(
          {
            id: "not-iterable-repair",
            kind: "repair",
            group: "bug",
            concept: "loops",
            title: "Choose the repair",
            context: `Line ${line} reads ${code(text)} and ${code(name)} is ${n}.`,
            prompt: `Which loop runs ${n} times, with ${code(v)} going 0, 1, …?`,
            explanation: `${code(`range(${name})`)} produces 0 through ${name} − 1. ${code(`[${name}]`)} is a one-item list, so the loop would run once, and ${code(`${name}()`)} tries to call a number.`,
            hints: ["Which built-in turns a count into a sequence of numbers?"],
            step: i,
            focusLine: line,
            edit: { mode: "replace", line },
          },
          [code(`for ${v} in range(${name}):`), code(`for ${v} in [${name}]:`), code(`for ${v} in ${name}():`)],
          0,
        ),
      );
    }
    return out;
  }

  const noneUse = msg.match(/^TypeError: 'NoneType' object is not (subscriptable|iterable|callable)/);
  if (noneUse) return noneValueQuestions(ctx, i, where);

  if (/^TypeError: (can only concatenate str|unsupported operand type)/.test(msg)) {
    const noneOperand = msg.includes("'NoneType'");
    if (noneOperand) {
      const fromFn = noneValueQuestions(ctx, i, where);
      if (fromFn.length) return fromFn;
    }
    return [
      make(
        {
          id: noneOperand ? "none-operand" : "str-concat",
          kind: "explain",
          group: "bug",
          concept: "types",
          title: "Read the type error",
          context: where,
          prompt: `Why can't Python run the operation on line ${line}?`,
          explanation: noneOperand
            ? "One side of the operator was None. That often means a function finished without reaching a `return`, so its result was None. Step back to where that value came from."
            : "Python doesn't turn numbers into text automatically for `+`. Convert explicitly, for example `str(n)`, or use an f-string.",
          hints: ["Look at the types of the values on each side of the operator."],
          step: i,
          focusLine: line,
        },
        noneOperand
          ? ["One operand was None, often from a function that ended without `return`", "Python can't add negative numbers", "The variable was never declared"]
          : ["`+` between text and a number isn't defined; convert one side first", "Strings can't contain digits", "`print` can only show one value"],
        0,
      ),
    ];
  }

  const badInt = msg.match(/invalid literal for int\(\) with base 10: '(.*)'/);
  if (badInt) return badIntQuestions(ctx, i, badInt[1], where);

  const nameErr = msg.match(/name '(\w+)' is not defined/);
  if (nameErr) {
    const name = nameErr[1];
    const words = [...new Set(ctx.lines.join("\n").match(new RegExp(IDENT, "g")) ?? [])].filter((w) => w !== name && !PY_WORDS.has(w));
    const suggestion = words
      .map((w) => [w, editDistance(w, name)] as const)
      .filter(([, d]) => d <= 2)
      .sort((a, b) => a[1] - b[1])[0]?.[0];
    return [
      make(
        {
          id: "name-error",
          kind: "explain",
          group: "bug",
          concept: "names",
          title: "Read the NameError",
          context: where,
          prompt: `Why doesn't Python know ${code(name)}?`,
          explanation: suggestion
            ? `Nothing named ${code(name)} exists at this point. Your code does use ${code(suggestion)}; check the spelling, and that it's assigned before this line runs.`
            : `Nothing named ${code(name)} exists at this point. Assign it before this line, or check its spelling.`,
          hints: ["Search your code for where this name gets its value."],
          step: i,
          focusLine: line,
        },
        [
          suggestion ? `It was never assigned; it's probably a typo for ${code(suggestion)}` : "It was never assigned before this line",
          "Python needs `var` before a new variable",
          "Variables must be declared at the top of the file",
        ],
        0,
      ),
    ];
  }

  if (/^AssertionError/.test(msg)) {
    const cond = text.match(/^assert\s+(.+?)(?:\s*,.*)?$/)?.[1];
    const names = [...new Set(cond?.match(new RegExp(CHAIN, "g")) ?? [])].filter((n) => !PY_WORDS.has(n) && evalChain(step, n) !== undefined);
    const values = names.map((n) => `${code(n)} was ${describe(step, evalChain(step, n))}`).join(", ");
    return [
      make(
        {
          id: "assertion",
          kind: "explain",
          group: "bug",
          concept: "assertions",
          title: "Why did the assert fail?",
          context: where + (values ? ` At that moment ${values}.` : ""),
          prompt: `What does ${code("assert")} do when its condition is False?`,
          explanation: `${code("assert condition")} stops the program with AssertionError when the condition is False. ${cond ? `Here ${code(cond)} was False` : "The condition was False"}${values ? ` because ${values}` : ""}. The bug is wherever that value came from, not the assert itself.`,
          hints: ["Plug the recorded values into the condition.", "Step backward to where those values were set."],
          step: i,
          focusLine: line,
        },
        ["It raises AssertionError, so the program stops here", "It prints a warning and keeps going", "It changes the values until the condition is True"],
        0,
      ),
    ];
  }

  if (/^RecursionError/.test(msg)) return recursionQuestions(ctx, true);
  return [];
}

const ERROR_TYPES: Record<string, { meaning: string; hint: string }> = {
  TypeError: { meaning: "An operation got a value of the wrong type", hint: "Check the type of each value used on the line." },
  ValueError: { meaning: "A value had the right type but an unusable value", hint: "Look at the exact value passed in." },
  AttributeError: { meaning: "The object has no attribute or method with that name", hint: "What type is the object, and what methods does that type have?" },
  IndexError: { meaning: "An index was outside the valid range", hint: "Compare the index with the length." },
  KeyError: { meaning: "A dictionary was asked for a key it doesn't have", hint: "Which keys does the dictionary have at this moment?" },
  NameError: { meaning: "A name was used before anything was assigned to it", hint: "Where does this name get its value?" },
  ZeroDivisionError: { meaning: "A number was divided by zero", hint: "Which value is the divisor?" },
  RecursionError: { meaning: "Functions called each other too deeply without returning", hint: "Is there a base case that stops the recursion?" },
  StopIteration: { meaning: "next() was called on an iterator with no items left", hint: "How many items did the iterator have?" },
  ImportError: { meaning: "A module couldn't be imported", hint: "Is that module available here?" },
  ModuleNotFoundError: { meaning: "A module couldn't be found", hint: "Check the module name's spelling." },
  OverflowError: { meaning: "A number got too large to represent", hint: "Which value grew so large?" },
};

/** Any exception the specific rules don't cover still gets a grounded "what does this error mean?" question. */
function genericError(ctx: Ctx, i: number, msg: string, where: string): Question[] {
  const type = msg.match(/^(\w+)/)?.[1] ?? "";
  const info = ERROR_TYPES[type];
  if (!info) return [];
  const others = Object.entries(ERROR_TYPES)
    .filter(([t]) => t !== type)
    .map(([, v]) => v.meaning);
  const pick = (seed: number) => others[seed % others.length];
  const seed = type.length + ctx.trace[i].line;
  return [
    make(
      {
        id: `error-${type}`,
        kind: "explain",
        group: "bug",
        concept: "error-types",
        score: 80,
        title: `What does ${type} mean?`,
        context: where,
        prompt: `What is Python telling you with ${code(type)}?`,
        explanation: `${type}: ${info.meaning.toLowerCase()}. The message after the colon says which value or name, and the highlighted line is where it happened.`,
        hints: [info.hint],
        step: i,
        focusLine: ctx.trace[i].line,
      },
      choices(info.meaning, pick(seed), pick(seed + 3), pick(seed + 5))!,
      0,
    ),
  ];
}

function noneAttributeQuestions(ctx: Ctx, i: number, attr: string, where: string): Question[] {
  const step = ctx.trace[i];
  const line = step.line;
  const text = textAt(ctx, line);
  const chains = [...text.matchAll(new RegExp(`(${CHAIN})\\.${attr}\\b`, "g"))].map((m) => m[1]);
  const culprit = chains.find((c) => evalChain(step, c) === null);
  if (!culprit) return noneValueQuestions(ctx, i, where);

  const parts = culprit.split(".");
  const base = parts[0];
  const parent = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  const parentVal = parent ? evalChain(step, parent) : undefined;
  const scope = currentFrame(step)?.encoded_locals ?? step.globals ?? {};
  const isData = (v: Encoded) => {
    if (!isRef(v)) return true;
    const kind = step.heap?.[String(v[1])]?.[0];
    return kind !== "FUNCTION" && kind !== "CLASS" && kind !== "module";
  };
  const otherVar = Object.keys(scope).find((n) => !n.startsWith("__") && n !== base && n !== culprit && isData(scope[n]));

  const out: Question[] = [];
  const opts = choices(
    code(culprit),
    parent ? code(parent) : undefined,
    culprit !== base ? code(base) : undefined,
    otherVar ? code(otherVar) : undefined,
    `${code(attr)} is misspelled`,
  );
  out.push(
    make(
      {
        id: "none-attribute",
        kind: "explain",
        group: "bug",
        concept: "none-pointer",
        title: "Find the None",
        context: where,
        prompt: `Which expression was ${code("None")} when line ${line} ran?`,
        explanation: parent
          ? `${code(parent)} is ${describe(step, parentVal)}, and its ${code(parts[parts.length - 1])} is None. Asking None for ${code("." + attr)} fails because None has no attributes.`
          : `${code(culprit)} was None, so there was no object to read ${code("." + attr)} from.`,
        hints: [`Find ${code(base)} in the memory diagram and follow its arrows.`, `Which object on line ${line} has no ${code(attr)} to read?`],
        step: i,
        focusLine: line,
      },
      opts!,
      0,
    ),
  );

  // Repair: the crash is inside `while X is not None:` and reads one link past X.
  const loop = enclosingWhile(ctx, line);
  const guard = loop?.condition.match(new RegExp(`^(${IDENT})(?:\\s+is\\s+not\\s+None|\\s*!=\\s*None)?$`));
  if (loop && guard && parts.length === 2 && parts[0] === guard[1]) {
    const v = guard[1];
    const next = culprit;
    out.push(
      make(
        {
          id: "none-guard-repair",
          kind: "repair",
          group: "bug",
          concept: "none-pointer",
          title: "Choose the repair",
          context: `Line ${loop.line} reads ${code(`while ${loop.condition}:`)}, so the loop body runs while ${code(v)} exists, even when ${code(next)} is None.`,
          prompt: `Which loop condition keeps line ${line} from reading through None?`,
          explanation: `${code("and")} checks left to right and stops at the first False, so ${code(next)} is only read when ${code(v)} exists. Checking ${code(`${next}.${parts[1]}`)} stops one node too early, and ${code("or")} keeps looping when only one side is True.`,
          hints: [`The loop has to stop when ${code(next)} is None, not only when ${code(v)} is.`, "Does the order of the two checks matter?"],
          step: i,
          focusLine: loop.line,
          edit: { mode: "replace", line: loop.line },
        },
        [
          code(`while ${v} is not None and ${next} is not None:`),
          code(`while ${v} is not None or ${next} is not None:`),
          code(`while ${v} is not None and ${next}.${parts[1]} is not None:`),
        ],
        0,
      ),
    );
  }
  return out;
}

/** A None that came from calling a function with no `return` (r = f(); r[0], r + 1, for x in r). */
function noneValueQuestions(ctx: Ctx, i: number, where: string): Question[] {
  const step = ctx.trace[i];
  const line = step.line;
  const text = textAt(ctx, line);
  const used = [...new Set(text.match(new RegExp(IDENT, "g")) ?? [])].filter((n) => !PY_WORDS.has(n) && lookup(step, n) === null);
  for (const name of used) {
    // Find where `name` was assigned from a call to a user function.
    for (let n = line; n >= 1; n--) {
      const m = textAt(ctx, n).match(new RegExp(`^${name}\\s*=\\s*(${IDENT})\\((.*)\\)$`));
      if (!m || !defLine(ctx, m[1])) continue;
      const fn = m[1];
      if (returnsValue(ctx, fn)) break;
      const def = defLine(ctx, fn);
      // The function's last local (what it probably meant to return), from its frame at return time.
      const retStep = ctx.trace.findIndex((s) => s.event === "return" && frameName(s) === fn);
      const f = retStep >= 0 ? currentFrame(ctx.trace[retStep]) : undefined;
      const locals = (f?.ordered_varnames ?? []).filter((v) => v !== "__return__");
      const candidate = locals[locals.length - 1];
      const out: Question[] = [
        make(
          {
            id: "returns-none",
            kind: "explain",
            group: "bug",
            concept: "returns-none",
            title: "Where did None come from?",
            context: `${where} ${code(name)} was None. It was assigned on line ${n}: ${code(textAt(ctx, n))}.`,
            prompt: `Why is ${code(name)} None?`,
            explanation: `${code(fn)} has no ${code("return")} statement, so calling it gives back None, whatever it computed or printed inside. Add ${code("return <value>")} at the end of ${code(fn)}.`,
            hints: [`Read ${code(`def ${fn}`)}. What does it hand back to the caller?`, "Printing a value isn't the same as returning it."],
            step: i,
            focusLine: def,
          },
          [`${code(fn)} has no ${code("return")}, so calling it gives None`, `${code(name)} was deleted after line ${n}`, "Lists turn into None after they're printed"],
          0,
        ),
      ];
      if (candidate) {
        out.push(
          make(
            {
              id: "returns-none-repair",
              kind: "repair",
              group: "bug",
              concept: "returns-none",
              title: "Choose the repair",
              context: `Inside ${code(fn)}, the value it builds is ${code(candidate)}.`,
              prompt: `Which line, added at the end of ${code(fn)}, hands ${code(candidate)} back to the caller?`,
              explanation: `${code(`return ${candidate}`)} sends the value back, so ${code(`${name} = ${fn}(...)`)} receives it. ${code(`print(${candidate})`)} only shows it on screen, and a bare ${code("return")} still returns None.`,
              hints: ["Which statement sends a value back to the caller?"],
              step: i,
              focusLine: def,
              edit: { mode: "insert-end", line: def },
            },
            [code(`return ${candidate}`), code(`print(${candidate})`), code("return")],
            0,
          ),
        );
      }
      return out;
    }
  }
  return [];
}

const METHOD_FIXES: Record<string, Record<string, string>> = {
  list: { push: "append", add: "append", push_back: "append", appendLast: "append", insertLast: "append", addAll: "extend", remove_at: "pop", contains: "count", indexOf: "index" },
  set: { append: "add", push: "add", insert: "add" },
  dict: { has_key: "get", add: "update", append: "update" },
  str: { toUpperCase: "upper", toLowerCase: "lower", trim: "strip", contains: "count", indexOf: "find", charAt: "__getitem__" },
};

function wrongMethodQuestions(ctx: Ctx, i: number, type: string, method: string, where: string): Question[] {
  const line = ctx.trace[i].line;
  const text = textAt(ctx, line);
  const fix = METHOD_FIXES[type]?.[method];
  const lengthLike = /^(length|size|len|count_items)$/.test(method);
  const out: Question[] = [];
  const right = lengthLike ? code("len(x)") : fix && fix !== "__getitem__" ? code(`.${fix}()`) : null;
  if (!right) {
    return [
      make(
        {
          id: "wrong-method",
          kind: "explain",
          group: "bug",
          concept: type === "str" ? "string-methods" : "list-methods",
          title: "Does that method exist?",
          context: where,
          prompt: `Why can't Python find ${code(`.${method}`)} on a ${code(type)}?`,
          explanation: `A ${code(type)} has no method called ${code(method)}. Type ${code(`help(${type})`)} or ${code(`dir(${type})`)} in Python to see the methods it does have.`,
          hints: [`Methods depend on the type. What type is the value on line ${line}?`],
          step: i,
          focusLine: line,
        },
        [`${code(type)} objects don't have a method named ${code(method)}`, "The variable wasn't created yet", "Methods must be imported before use"],
        0,
      ),
    ];
  }
  const what = lengthLike ? "get its length" : type === "list" && fix === "append" ? "add an item to the end" : type === "set" ? "add an item" : `do what ${code(`.${method}`)} was meant to`;
  out.push(
    make(
      {
        id: "wrong-method",
        kind: "explain",
        group: "bug",
        concept: type === "str" ? "string-methods" : "list-methods",
        title: "Pick the right method",
        context: where,
        prompt: `How do you ${what} for a Python ${code(type)}?`,
        explanation: `Python ${type}s don't have ${code(`.${method}`)}${lengthLike ? `; the built-in ${code("len()")} works on any collection` : `; the method is ${code(`.${fix}()`)}`}. Names like ${code(method)} come from other languages.`,
        hints: [`What type is the value on line ${line}?`],
        step: i,
        focusLine: line,
      },
      choices(right, code(`.${method}()`), lengthLike ? code(".count()") : code(type === "set" ? ".append()" : ".add()"), code(".insert()"))!,
      0,
    ),
  );
  if (fix && !lengthLike && text.includes(`.${method}(`)) {
    const swap = (m: string) => text.replace(`.${method}(`, `.${m}(`);
    const wrong = type === "list" ? (fix === "append" ? "add" : "push") : "append";
    const third = type === "list" ? "insert" : "push";
    if (swap(wrong) !== text && swap(third) !== text) {
      out.push(
        make(
          {
            id: "wrong-method-repair",
            kind: "repair",
            group: "bug",
            concept: type === "str" ? "string-methods" : "list-methods",
            title: "Choose the repair",
            context: `Line ${line} reads ${code(text)}.`,
            prompt: `Which line does what ${code(`.${method}`)} was meant to?`,
            explanation: `${code(`.${fix}()`)} is the ${type} method for this. The other names don't exist on ${type}s or need different arguments.`,
            hints: [`Which method does a ${code(type)} actually have?`],
            step: i,
            focusLine: line,
            edit: { mode: "replace", line },
          },
          [code(swap(fix)), code(swap(wrong)), code(swap(third))],
          0,
        ),
      );
    }
  }
  return out;
}

function indexQuestions(ctx: Ctx, i: number, where: string): Question[] {
  const step = ctx.trace[i];
  const line = step.line;
  const text = textAt(ctx, line);
  let found: { name: string; index: number; length: number } | null = null;
  for (const m of text.matchAll(new RegExp(`(${IDENT})\\[([^\\[\\]]+)\\]`, "g"))) {
    const length = lengthOf(step, lookup(step, m[1]));
    const index = evalIndex(step, m[2]);
    if (length !== undefined && index !== undefined && (index >= length || index < -length)) {
      found = { name: m[1], index, length };
      break;
    }
  }
  if (!found) return [];
  const { name, index, length } = found;
  const out: Question[] = [
    make(
      {
        id: "index-range",
        kind: "explain",
        group: "bug",
        concept: "list-bounds",
        title: "Explain the failed access",
        context: `${where} ${code(name)} has ${length} item${length === 1 ? "" : "s"}, and the line asked for index ${index}.`,
        prompt: `Which non-negative indices are valid for ${code(name)} right now?`,
        explanation: `A sequence of length n has indices 0 through n − 1 (and −1 through −n counting from the end). Index ${index} is outside that range, so Python raises IndexError.`,
        hints: ["Compare the index with the length shown in the diagram.", "Does the loop that produced this index include the length itself?"],
        step: i,
        focusLine: line,
      },
      length > 0 ? [`0 through ${length - 1}`, `1 through ${length}`, `0 through ${length}`] : ["None: the sequence is empty", "Only index 0", "Index 0 and −1"],
      0,
    ),
  ];
  for (let n = line - 1; n >= Math.max(1, line - 15); n--) {
    const raw = textAt(ctx, n);
    const forLoop = raw.match(new RegExp(`^for\\s+(${IDENT})\\s+in\\s+range\\((?:0,\\s*)?len\\(${name}\\)\\s*\\+\\s*1\\):$`));
    const whileLoop = raw.match(new RegExp(`^while\\s+(${IDENT})\\s*<=\\s*len\\(${name}\\):$`));
    if (forLoop) {
      const v = forLoop[1];
      out.push(
        make(
          {
            id: "index-repair",
            kind: "repair",
            group: "bug",
            concept: "list-bounds",
            title: "Choose the repair",
            context: `Line ${n} reads ${code(raw)}, so ${code(v)} reaches ${length}, one past the last valid index.`,
            prompt: "Which loop header visits every valid index exactly once?",
            explanation: `${code(`range(len(${name}))`)} produces 0 through len − 1, exactly the valid indices. Starting at 1 skips the first item; ending at len + 1 still goes one too far.`,
            hints: ["What's the last number `range(n)` produces?", "Which index does the first item have?"],
            step: i,
            focusLine: n,
            edit: { mode: "replace", line: n },
          },
          [code(`for ${v} in range(len(${name})):`), code(`for ${v} in range(1, len(${name}) + 1):`), code(`for ${v} in range(1, len(${name})):`)],
          0,
        ),
      );
      break;
    }
    if (whileLoop) {
      const v = whileLoop[1];
      out.push(
        make(
          {
            id: "index-repair",
            kind: "repair",
            group: "bug",
            concept: "list-bounds",
            title: "Choose the repair",
            context: `Line ${n} reads ${code(raw)}, so the body still runs when ${code(v)} equals the length.`,
            prompt: "Which condition keeps every access in range?",
            explanation: `${code(`${v} < len(${name})`)} stops as soon as ${code(v)} reaches the length, so the last access uses index len − 1.`,
            hints: ["Which comparison excludes the boundary value itself?"],
            step: i,
            focusLine: n,
            edit: { mode: "replace", line: n },
          },
          [code(`while ${v} < len(${name}):`), code(`while ${v} <= len(${name}) + 1:`), code(`while ${v} != len(${name}) + 1:`)],
          0,
        ),
      );
      break;
    }
  }
  return out;
}

function zeroDivisionQuestions(ctx: Ctx, i: number, where: string): Question[] {
  const step = ctx.trace[i];
  const line = step.line;
  const text = textAt(ctx, line);
  const div = text.match(new RegExp(`^(${IDENT})\\s*=\\s*(.+?)\\s*(//|/|%)\\s*(${IDENT})$`));
  const divisorIsZero = !!div && lookup(step, div[4]) === 0;
  const out: Question[] = [
    make(
      {
        id: "zero-division",
        kind: "explain",
        group: "bug",
        concept: "division-by-zero",
        title: "Explain the crash",
        context: where + (divisorIsZero ? ` At that moment ${code(div![4])} was 0.` : ""),
        prompt: "What makes Python raise this error?",
        explanation:
          "Division (`/`, `//`) and remainder (`%`) need a nonzero divisor. Find where the divisor got its value and decide what the code should do when there's nothing to divide by.",
        hints: ["Look at the value on the right of the division operator.", "Which variable in the current frame is 0?"],
        step: i,
        focusLine: line,
      },
      ["The divisor was 0", "The result would have been negative", "The result would have had decimals"],
      0,
    ),
  ];
  if (div && divisorIsZero) {
    const [, target, left, op, d] = div;
    const otherOp = op === "%" ? "//" : "%";
    out.push(
      make(
        {
          id: "zero-division-repair",
          kind: "repair",
          group: "bug",
          concept: "division-by-zero",
          title: "Choose the repair",
          context: `Line ${line} reads ${code(text)} and ${code(d)} was 0.`,
          prompt: `Which version handles ${code(`${d} == 0`)} without changing the answer for normal input?`,
          explanation: `Checking ${code(d)} first skips the division when it's 0. Adding 1 to the divisor avoids the crash but changes every other result, and ${code(otherOp)} by zero raises the same error.`,
          hints: ["The fix should only matter when the divisor is 0.", `Would dividing by ${code(`${d} + 1`)} still give the right answer when ${code(d)} isn't 0?`],
          step: i,
          focusLine: line,
          edit: { mode: "replace", line },
        },
        [code(`${target} = ${left} ${op} ${d} if ${d} != 0 else 0`), code(`${target} = ${left} ${op} (${d} + 1)`), code(`${target} = ${left} ${otherOp} ${d}`)],
        0,
      ),
    );
  }
  return out;
}

function keyErrorQuestions(ctx: Ctx, i: number, key: string, where: string): Question[] {
  const step = ctx.trace[i];
  const line = step.line;
  const text = textAt(ctx, line);
  const out: Question[] = [];
  let dictName: string | null = null;
  let keys: string[] | null = null;
  for (const m of text.matchAll(new RegExp(`(${IDENT})\\[([^\\[\\]]+)\\]`, "g"))) {
    const obj = heapOf(step, lookup(step, m[1]));
    if (obj?.[0] === "DICT") {
      dictName = m[1];
      keys = (obj.slice(1) as [Encoded, Encoded][]).map(([k]) => primitiveText(k));
      break;
    }
  }
  if (dictName && keys) {
    const shown = keys.length > 6 ? `${keys.slice(0, 6).join(", ")}, …` : keys.join(", ");
    out.push(
      make(
        {
          id: "key-error",
          kind: "explain",
          group: "bug",
          concept: "dict-missing-key",
          title: "Check the keys",
          context: where,
          prompt: `Was ${code(key)} a key in ${code(dictName)} when line ${line} ran?`,
          explanation: `${keys.length ? `${code(dictName)} only had ${shown}` : `${code(dictName)} was still empty`}, so ${code(`${dictName}[${key}]`)} raised KeyError. ${code(`${key} in ${dictName}`)} checks first, and ${code(`${dictName}.get(${key}, default)`)} returns a fallback instead of raising.`,
          hints: [`Find ${code(dictName)}'s card in the diagram and read its keys.`],
          step: i,
          focusLine: line,
        },
        [keys.length ? `No: ${code(dictName)} only had ${shown}` : `No: ${code(dictName)} was still empty`, "Yes, but its value was None", "Yes, but the dictionary was locked while Python read it"],
        0,
      ),
    );
  } else {
    out.push(
      make(
        {
          id: "key-error",
          kind: "explain",
          group: "bug",
          concept: "dict-missing-key",
          title: "What does d[key] do?",
          context: `${where} The dictionary had no entry for ${code(key)}.`,
          prompt: "What happens when you read a missing key with `d[key]`?",
          explanation: "Indexing a dict with a key it doesn't have raises KeyError. `d.get(key, default)` returns a fallback instead, and `key in d` lets you check first.",
          hints: ["Check the dict card in the diagram: is that key there?"],
          step: i,
          focusLine: line,
        },
        ["Python raises KeyError", "It returns None", "It returns 0"],
        0,
      ),
    );
  }
  const inc = text.match(new RegExp(`^(${IDENT})\\[(.+)\\]\\s*\\+=\\s*1$`));
  if (inc) {
    const [, d, k] = inc;
    out.push(
      make(
        {
          id: "key-error-repair",
          kind: "repair",
          group: "bug",
          concept: "dict-missing-key",
          title: "Choose the repair",
          context: `Line ${line} reads ${code(text)}. The first time a key shows up, it isn't in ${code(d)} yet.`,
          prompt: "Which line counts the first occurrence as 1?",
          explanation: `${code(`${d}.get(${k}, 0)`)} gives 0 for a new key, so the first occurrence stores 1. ${code(`${d}.get(${k})`)} returns None, and None + 1 fails. You can't assign to a function call.`,
          hints: ["You need a value to use when the key is missing.", "dict has a method that takes a fallback value."],
          step: i,
          focusLine: line,
          edit: { mode: "replace", line },
        },
        [code(`${d}[${k}] = ${d}.get(${k}, 0) + 1`), code(`${d}[${k}] = ${d}.get(${k}) + 1`), code(`${d}.get(${k}, 0) += 1`)],
        0,
      ),
    );
  }
  return out;
}

function unboundLocalQuestions(ctx: Ctx, i: number, name: string, where: string): Question[] {
  const fn = frameName(ctx.trace[i]);
  const def = fn !== "<module>" ? defLine(ctx, fn) : 0;
  const out: Question[] = [
    make(
      {
        id: "unbound-local",
        kind: "explain",
        group: "bug",
        concept: "scope",
        title: "Local or global?",
        context: where,
        prompt: `Why can't ${code(fn)} read ${code(name)}?`,
        explanation: `Because ${code(fn)} assigns to ${code(name)} (here with ${code("+=")} or ${code("=")}), Python treats ${code(name)} as a local variable for the whole function. The local has no value yet when it's read. Pass the value in and return the new one, or declare ${code(`global ${name}`)}.`,
        hints: [`Does ${code(fn)} assign to ${code(name)} anywhere?`, "Which variables does a function treat as its own?"],
        step: i,
        focusLine: def || ctx.trace[i].line,
      },
      [
        `${code(fn)} assigns to ${code(name)}, so Python treats it as a local that has no value yet`,
        `${code(name)} was deleted when the program started ${code(fn)}`,
        "Functions can never read variables defined outside them",
      ],
      0,
    ),
  ];
  if (def) {
    out.push(
      make(
        {
          id: "unbound-local-repair",
          kind: "repair",
          group: "bug",
          concept: "scope",
          title: "Choose the repair",
          context: `${code(fn)} is meant to update the ${code(name)} defined outside it.`,
          prompt: `Which line, added at the start of ${code(fn)}, makes it update the outer ${code(name)}?`,
          explanation: `${code(`global ${name}`)} tells Python that ${code(name)} inside ${code(fn)} is the module-level variable. Setting it to 0 first creates a separate local and loses the outer value. (Returning the new value is often cleaner than ${code("global")}.)`,
          hints: ["You need to tell Python which variable the name refers to."],
          step: i,
          focusLine: def,
          edit: { mode: "insert-start", line: def },
        },
        [code(`global ${name}`), code(`${name} = 0`), code(`${name} = ${name}`)],
        0,
      ),
    );
  }
  return out;
}

function badIntQuestions(ctx: Ctx, i: number, input: string, where: string): Question[] {
  const line = ctx.trace[i].line;
  const text = textAt(ctx, line);
  const decimal = /^\s*[+-]?\d*\.\d+\s*$/.test(input);
  const out: Question[] = [
    make(
      {
        id: "bad-int",
        kind: "explain",
        group: "bug",
        concept: "parsing-input",
        title: "Explain the conversion",
        context: `${where} ${code("int()")} received ${code(JSON.stringify(input))}.`,
        prompt: "Why couldn't this text become an int?",
        explanation: "`int()` accepts an optional sign and digits (surrounding spaces are fine). A decimal point, letters, or empty text make it fail; `float()` reads decimals.",
        hints: ["Look at the exact text in the error message.", decimal ? "Is a decimal point part of a whole number?" : "Is every character a digit?"],
        step: i,
        focusLine: line,
      },
      [
        input.trim() === ""
          ? "The text was empty, so there was no number to read"
          : decimal
            ? `${JSON.stringify(input)} has a decimal point, and int() only reads whole numbers`
            : `${JSON.stringify(input)} isn't a whole number written with digits`,
        "`int()` only accepts numbers typed in the source code",
        "`input()` closed before the value was read",
      ],
      0,
    ),
  ];
  const conv = text.match(new RegExp(`^(${IDENT})\\s*=\\s*int\\((.+)\\)$`));
  if (conv && decimal) {
    const [, target, arg] = conv;
    out.push(
      make(
        {
          id: "bad-int-repair",
          kind: "repair",
          group: "bug",
          concept: "parsing-input",
          title: "Choose the repair",
          context: `Line ${line} reads ${code(text)} and the input has a decimal point.`,
          prompt: "Which line reads a number that may have decimals?",
          explanation: `${code(`float(${arg})`)} accepts text like ${JSON.stringify(input)}. Stripping spaces doesn't remove the decimal point, and adding 0.0 happens after int() has already failed.`,
          hints: ["You need a type that can hold a fractional part."],
          step: i,
          focusLine: line,
          edit: { mode: "replace", line },
        },
        [code(`${target} = float(${arg})`), code(`${target} = int(${arg}.strip())`), code(`${target} = int(${arg}) + 0.0`)],
        0,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Syntax errors (no trace: the program never started)
// ---------------------------------------------------------------------------

export function syntaxQuestions(ctx: Ctx): Question[] {
  const { result } = ctx;
  const msg = result.message ?? "";
  const line = result.error_line ?? 0;
  if (result.status !== "error" || !line || !/^(SyntaxError|IndentationError)/.test(msg)) return [];
  const raw = ctx.lines[line - 1] ?? "";
  const text = raw.trim();
  const short = msg.replace(/ \(<string>, line \d+\)$/, "");
  const where = `Python couldn't start the program: line ${line} (${code(text)}) has ${code(short)}.`;
  const base = { kind: "repair" as const, group: "bug" as const, step: -1, focusLine: line };

  if (/expected ':'/.test(msg)) {
    return [
      make(
        { ...base, id: "syntax-colon", concept: "syntax", title: "What's missing?", context: where, prompt: `What does line ${line} need at the end?`, explanation: `Lines that start a block (${code("if")}, ${code("for")}, ${code("while")}, ${code("def")}, ${code("class")}, ${code("else")}) end with a colon. The indented lines after it are the block.`, hints: ["Look at the last character of the line.", "How does Python know where a block starts?"], edit: { mode: "replace", line } },
        [code(`${text}:`), code(`${text};`), code(`${text} {`)],
        0,
      ),
    ];
  }
  if (/Maybe you meant '==' or ':=' instead of '='/.test(msg) && / = /.test(text)) {
    const with_ = (op: string) => text.replace(/ = /, ` ${op} `);
    return [
      make(
        { ...base, id: "syntax-equals", concept: "syntax", title: "Compare, don't assign", context: where, prompt: "Which operator checks whether two values are equal?", explanation: `${code("=")} assigns a value; ${code("==")} compares two values and gives True or False. Conditions in ${code("if")} and ${code("while")} need a comparison.`, hints: ["One operator stores a value, the other asks a question."], edit: { mode: "replace", line } },
        [code(with_("==")), code(with_("===")), code(with_("=>"))],
        0,
      ),
    ];
  }
  const unclosed = msg.match(/'([([{])' was never closed/);
  if (unclosed) {
    const open = unclosed[1];
    const close = { "(": ")", "[": "]", "{": "}" }[open]!;
    const missing = Math.max(1, [...text].filter((c) => c === open).length - [...text].filter((c) => c === close).length);
    const other = open === "(" ? "]" : ")";
    return [
      make(
        { ...base, id: "syntax-unclosed", concept: "syntax", title: "Count the brackets", context: where, prompt: `How do you close the ${code(open)} that line ${line} opens?`, explanation: `Every ${code(open)} needs a matching ${code(close)}. Line ${line} opens ${missing} more than it closes, so Python keeps reading the next lines as part of it.`, hints: [`Count the ${code(open)} and ${code(close)} on line ${line}.`], edit: { mode: "replace", line } },
        [code(text + close.repeat(missing)), code(text + other), code(text + open)],
        0,
      ),
    ];
  }
  if (/unterminated string literal/.test(msg)) {
    const quote = text.match(/(['"])[^'"]*$/)?.[1];
    if (quote) {
      const otherQuote = quote === "'" ? '"' : "'";
      return [
        make(
          { ...base, id: "syntax-string", concept: "syntax", title: "Close the string", context: where, prompt: `How do you finish the string that starts with ${code(quote)} on line ${line}?`, explanation: `A string ends with the same quote it starts with. This one opens with ${code(quote)} and the line ends before a matching ${code(quote)}.`, hints: ["Which quote character opened the string?"], edit: { mode: "replace", line } },
          [code(text + quote), code(text + otherQuote), code(text.replace(quote, ""))],
          0,
        ),
      ];
    }
  }
  if (/expected an indented block/.test(msg)) {
    return [
      make(
        { ...base, id: "syntax-indent", concept: "indentation", title: "Indent the block", context: where, prompt: `How should line ${line} be written?`, explanation: "The line after a colon starts the block, and Python knows it's inside the block because it's indented (4 spaces by convention).", hints: ["Look at the line above. What did it start?"], edit: { mode: "replace-raw", line } },
        [code("    " + text), code(text), code("{ " + text + " }")],
        0,
      ),
    ];
  }
  if (/unexpected indent/.test(msg)) {
    return [
      make(
        { ...base, id: "syntax-dedent", concept: "indentation", title: "Line up the code", context: where, prompt: `How should line ${line} be written?`, explanation: `Indentation means "this line is inside the block above". Line ${line} is indented, but the line before it doesn't start a block, so it should line up with it.`, hints: ["Does the line above end with a colon?"], edit: { mode: "replace-raw", line } },
        [code(text), code("    " + raw), code("\t" + text)],
        0,
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The BST insert bug: a recursive call whose return value is thrown away
// ---------------------------------------------------------------------------

export function ignoredReturnQuestions(ctx: Ctx): Question[] {
  const call = new RegExp(`^(${IDENT})\\((${IDENT}\\.${IDENT})\\s*(,[^()]*)?\\)$`);
  for (let n = 1; n <= ctx.lines.length; n++) {
    const text = textAt(ctx, n);
    const m = text.match(call);
    if (!m) continue;
    const [, fn, target, rest = ""] = m;
    if (!returnsValue(ctx, fn)) continue;
    const step = ctx.trace.findIndex((s) => s.event === "step_line" && s.line === n);
    if (step < 0) continue;
    const sibling = ctx.lines.findIndex((l) => new RegExp(`${CHAIN}\\s*=\\s*${fn}\\(`).test(l));
    const args = `${target}${rest}`;
    const base = target.split(".")[0];
    return [
      make(
        {
          id: "ignored-return",
          kind: "repair",
          group: "bug",
          concept: "recursion-return",
          title: "Where does the new node go?",
          context: `Line ${n} calls ${code(`${fn}(${args})`)} but throws away what it returns.` + (sibling >= 0 ? ` Line ${sibling + 1} (${code(ctx.lines[sibling].trim())}) keeps its result.` : ""),
          prompt: `Which line keeps the result of ${code(fn)} attached?`,
          explanation: `${code(fn)} builds and returns the updated subtree, but nothing stores it, so ${code(target)} stays as it was. Assigning the result back to ${code(target)} makes the link.` + (sibling >= 0 ? ` That's exactly what line ${sibling + 1} does.` : ""),
          hints: sibling >= 0 ? [`Compare line ${n} with line ${sibling + 1}.`, `Where does the object created inside ${code(fn)} end up?`] : [`Where does the object created inside ${code(fn)} end up?`],
          step,
          focusLine: n,
          edit: { mode: "replace", line: n },
        },
        [code(`${target} = ${fn}(${args})`), code(`return ${fn}(${args})`), code(`${base} = ${fn}(${args})`)],
        0,
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Runs that never finish
// ---------------------------------------------------------------------------

export function loopQuestions(ctx: Ctx): Question[] {
  if (ctx.result.status !== "step_limit") return [];
  const window = ctx.trace.slice(-80).filter((s) => s.event === "step_line");
  const groups = new Map<string, TraceStep[]>();
  for (const s of window) {
    const key = `${s.line}|${frameId(s)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const hits of [...groups.values()].sort((a, b) => b.length - a.length)) {
    if (hits.length < 3) break;
    const line = hits[0].line;
    const text = textAt(ctx, line);
    const loop = text.match(/^while\s+(.+):$/);
    if (!loop) continue;
    const condition = loop[1].trim();
    const names = [...new Set(condition.match(new RegExp(IDENT, "g")) ?? [])].filter((n) => {
      if (PY_WORDS.has(n)) return false;
      const v = lookup(hits[0], n);
      return typeof v === "number" || typeof v === "string" || typeof v === "boolean";
    });
    if (!names.length || !names.every((n) => hits.every((h) => same(lookup(h, n), lookup(hits[0], n))))) continue;
    const step = ctx.trace.indexOf(hits[hits.length - 1]);
    const values = names.map((n) => `${code(n)} was ${primitiveText(lookup(hits[0], n) as Encoded)}`).join(" and ");
    const out: Question[] = [
      make(
        {
          id: "loop-stuck",
          kind: "explain",
          group: "bug",
          concept: "loop-termination",
          title: "Why doesn't the loop end?",
          context: `The run reached line ${line} (${code(text)}) ${hits.length} times in its last ${window.length} steps before the step limit stopped it. ${values} every time.`,
          prompt: `Why can ${code(condition)} stay true forever?`,
          explanation: "A loop ends only when its condition becomes false. Nothing in the body changed the values the condition depends on, so it gave the same answer every time.",
          hints: ["Compare the condition's variables across two visits to the loop header.", "Which statement should move the loop toward its end?"],
          step,
          focusLine: line,
        },
        [`Nothing in the loop changes ${names.map(code).join(" or ")}`, "Python repeats a while loop until the step limit", "The condition is only checked before the first iteration"],
        0,
      ),
    ];
    const simple = condition.match(new RegExp(`^(${IDENT})\\s*(<=|<|>=|>)\\s*(.+)$`));
    if (simple && names.includes(simple[1])) {
      const [, v, op] = simple;
      const up = op.startsWith("<");
      out.push(
        make(
          {
            id: "loop-repair",
            kind: "repair",
            group: "bug",
            concept: "loop-termination",
            title: "Choose the repair",
            context: `${code(v)} stayed ${primitiveText(lookup(hits[0], v) as Encoded)} while ${code(condition)} was checked ${hits.length} times.`,
            prompt: `Which statement, added at the end of the loop body, lets ${code(condition)} eventually become false?`,
            explanation: `${code(`${v} ${up ? "+=" : "-="} 1`)} moves ${code(v)} toward the bound on every pass, so the condition eventually fails. Moving the other way, or reassigning the same value, keeps it true forever.`,
            hints: [`Should ${code(v)} grow or shrink for the condition to become false?`],
            step,
            focusLine: line,
            edit: { mode: "insert-end", line },
          },
          [code(`${v} ${up ? "+=" : "-="} 1`), code(`${v} ${up ? "-=" : "+="} 1`), code(`${v} = ${v}`)],
          0,
        ),
      );
    }
    return out;
  }
  return [];
}

export function recursionQuestions(ctx: Ctx, fromError = false): Question[] {
  if (!fromError && ctx.result.status !== "step_limit") return [];
  let lastIndex = ctx.trace.length - 1;
  while (lastIndex > 0 && !liveFrames(ctx.trace[lastIndex]).length) lastIndex--;
  const last = ctx.trace[lastIndex];
  const frames = liveFrames(last);
  const name = frames.find((f) => f.is_highlighted)?.func_name ?? frames[frames.length - 1]?.func_name;
  if (!name) return [];
  const depth = frames.filter((f) => f.func_name === name).length;
  if (depth < 12) return [];
  if (ctx.trace.some((s) => s.event === "return" && frameName(s) === name)) return [];

  const deepest = frames.filter((f) => f.func_name === name).at(-1)!;
  const firstFrame = frames.find((f) => f.func_name === name)!;
  const param = (deepest.ordered_varnames ?? []).find((p) => typeof deepest.encoded_locals[p] === "number");
  const startVal = param ? asNumber(firstFrame.encoded_locals[param]) : undefined;
  const endVal = param ? asNumber(deepest.encoded_locals[param]) : undefined;
  const def = defLine(ctx, name);

  const out: Question[] = [
    make(
      {
        id: "runaway-recursion",
        kind: "explain",
        group: "bug",
        concept: "recursion",
        title: "Why doesn't the recursion end?",
        context: `The run stacked ${depth} calls to ${code(name)} and none of them returned.` + (param && startVal !== undefined && endVal !== undefined ? ` ${code(param)} went from ${startVal} to ${endVal}.` : ""),
        prompt: `Why does ${code(name)} keep calling itself?`,
        explanation: `Every call to ${code(name)} makes another call before it can return, so the stack only grows. A base case returns without recursing; it's what lets the calls unwind.`,
        hints: ["Is there any path through the function that doesn't call itself?", "Watch the parameter go past the value where the answer is obvious."],
        step: lastIndex,
        focusLine: def || undefined,
      },
      [`Every call reaches another call to ${code(name)} before any base case returns`, "Python only allows a dozen nested calls", "Recursive functions must return a string"],
      0,
    ),
  ];
  if (param && startVal !== undefined && endVal !== undefined && endVal < startVal && def) {
    out.push(
      make(
        {
          id: "recursion-repair",
          kind: "repair",
          group: "bug",
          concept: "recursion",
          title: "Choose the repair",
          context: `${code(param)} shrinks with every call, so the recursion needs to stop once it reaches 0.`,
          prompt: `Which line, added at the start of ${code(name)}, gives the recursion a way to stop?`,
          explanation: `${code(`if ${param} <= 0: return 0`)} returns without recursing, so the calls unwind and each finishes its own work on the way back. Pick the value your smallest case should return.`,
          hints: ["The base case must return without calling the function again."],
          step: lastIndex,
          focusLine: def,
          edit: { mode: "insert-start", line: def },
        },
        [code(`if ${param} <= 0: return 0`), code(`if ${param} <= 0: return ${name}(${param})`), code(`${param} = ${param} - 1`)],
        0,
      ),
    );
  }
  return out;
}
