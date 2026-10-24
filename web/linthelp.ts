/**
 * Plain-language explanations for the Eclipse compiler's as-you-type problems, especially the warnings that
 * point at beginner bugs which still compile (an if with a stray semicolon, x = x, a missing break).
 */
const RULES: [RegExp, (...m: string[]) => string][] = [
  [/^The value of the local variable (\w+) is not used/, x => `${x} gets a value that is never read. Remove it, or check whether a later line should use it.`],
  [/^The value of the field ([\w.]+) is not used/, x => `Nothing reads ${x.split('.').at(-1)}. Remove it, or check that the code meant to use it.`],
  [/^The (?:method|constructor) (.+) from the type \w+ is never used locally/, x => `Nothing calls ${x}. Call it where it is needed, or remove it.`],
  [/^The assignment to variable (\w+) has no effect/, x => `This sets ${x} to itself, so nothing changes. In a constructor or setter you probably meant this.${x} = ${x};`],
  [/^Comparing identical expressions/, () => 'Both sides are the same expression, so the result never changes. Check that you compared the variables you meant to.'],
  [/^Empty control-flow statement/, () => 'A semicolon right after if (…), for (…) or while (…) ends the statement there. The block below then runs regardless of the condition, or the loop repeats nothing. Remove the semicolon.'],
  [/^Null pointer access: The variable (\w+) can only be null at this location/, x => `${x} is always null here, so using it throws NullPointerException. Assign an object to ${x} first.`],
  [/^Potential null pointer access: The variable (\w+) may be null at this location/, x => `On some paths ${x} is still null here. Check for null, or make sure every path assigns an object.`],
  [/^Redundant null check: The variable (\w+) (?:can only|cannot) be null/, x => `This null check on ${x} always gives the same answer, so one branch can never run.`],
  [/^Switch case may be entered by falling through previous case/, () => 'Without break, the previous case keeps running into this one. Add break; at the end of the previous case, unless running both is intended.'],
  [/^Unlikely argument type for equals\(\): (\S+) seems to be unrelated to (\S+)/, (a, b) => `A ${b} is never equal to ${/^[aeiou]/i.test(a) ? 'an' : 'a'} ${a}, so this equals is always false. Compare values of the same type.`],
  [/^Unlikely argument type (\S+) for (\w+)\(Object\) on a (\S+)/, (a, method, on) => `${method}() on ${/^[aeiou]/i.test(on) ? 'an' : 'a'} ${on} with ${/^[aeiou]/i.test(a) ? 'an' : 'a'} ${a} never finds anything, because the types don't match.`],
  [/^Dead code/, () => 'This code can never run: an earlier return, break or a condition that is always true or false skips it.'],
  [/^Unreachable code/, () => 'This line can never run, because the code just above always leaves the block first.'],
  [/^The import ([\w.]+) is never used/, x => `Nothing in this file uses ${x.split('.').at(-1)}. Remove the import, or press Shift+Alt+O to organize imports.`],
  [/^Possible accidental assignment in place of a comparison/, () => '= assigns a value; == compares. Inside a condition you almost always want ==.'],
  [/^(\w+) is a raw type/, x => `Give ${x} a type argument, such as ${x}<String>, so Java can check what goes into it.`],
  [/^Resource leak: '(\w+)' is never closed/, x => `${x} is never closed. That's harmless for a Scanner on System.in; close files and streams you open, or use try-with-resources.`],
  [/^(\w+) cannot be resolved to a type/, x => `Java doesn't know a type called ${x}. Check the spelling and capitals, or add an import (Ctrl+. offers one).`],
  [/^(\w+) cannot be resolved to a variable/, x => `Nothing named ${x} is declared where this line can see it. Check the spelling, and that it is declared before this line in the same block.`],
  [/^(\w+) cannot be resolved$/, x => `Nothing named ${x} is declared where this line can see it.`],
  [/^The method (\w+)\((.*)\) is undefined for the type (\S+)/, (m, args, type) => `${type} has no method ${m}${args ? ` that takes (${args})` : '()'}. Check the name, its capitals, and the arguments.`],
  [/^Type mismatch: cannot convert from (\S+) to (\S+)/, (a, b) => `The value is ${/^[aeiou]/i.test(a) ? 'an' : 'a'} ${a}, but this spot needs ${/^[aeiou]/i.test(b) ? 'an' : 'a'} ${b}.${a === 'double' && /^(int|long)$/.test(b) ? ' Converting would lose the fractional part, so Java asks you to choose: change the variable type or cast.' : a === 'String' ? ' Text must be parsed, for example with Integer.parseInt.' : ''}`],
  [/^Syntax error, insert "(.+?)" to complete/, x => `Something is missing here: Java expected ${x.replace(/^;$/, 'a semicolon (;)').replace(/^\}$/, 'a closing brace (})').replace(/^\)$/, 'a closing parenthesis')}.`],
  [/^Syntax error on token "(.+?)", (.+)/, (token, what) => `Java didn't expect ${token} here (${what.replace(/expected.*/, 'expected something else').replace(/delete this token/, 'it suggests deleting it')}).`],
  [/^This method must return a result of type (\S+)/, x => `Some path through this method reaches the end without returning ${/^[aeiou]/i.test(x) ? 'an' : 'a'} ${x}, for example when an if condition is false.`],
  [/^The local variable (\w+) may not have been initialized/, x => `${x} has no value on some path before this line. Give it a starting value where it is declared.`],
  [/^Cannot make a static reference to the non-static (?:method|field) (\w+)/, x => `main is static and has no object, but ${x} belongs to an object. Make ${x} static, or create an object first.`],
  [/^Unhandled exception type (\w+)/, x => `${x} is a checked exception: catch it with try/catch, or add throws ${x} to the method.`],
  [/^Duplicate local variable (\w+)/, x => `${x} is already declared in this scope. To change its value, assign it without the type.`],
  [/^String literal is not properly closed/, () => 'A string must end with " on the same line.'],
  [/^Incompatible operand types (\S+) and (\S+)/, (a, b) => `${a} and ${b} can't be compared with ==. Convert one side first; compare Strings with equals().`],
  [/^The operator (\S+) is undefined for the argument type\(s\) (\S+), (\S+)/, (op, a, b) => `${op} doesn't work between ${a} and ${b}.`],
  [/^Cannot invoke (\S+) on the primitive type (\w+)/, (call, type) => `${type} is a primitive, not an object, so it has no methods like ${call}.`],
  [/^The public type (\w+) must be defined in its own file/, x => `A public class must be in a file named ${x}.java.`],
];

export function lintHelp(message: string): string | null {
  for (const [pattern, explain] of RULES) {
    const m = message.match(pattern);
    if (m) return explain(...m.slice(1));
  }
  return null;
}
