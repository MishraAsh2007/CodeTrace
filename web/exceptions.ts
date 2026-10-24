/** What a Java exception means and its usual causes, in plain language. */
export type Guide = { meaning: string; causes: string[] };
/** What an exception means and its usual causes, for any type the Tutor has no dedicated questions for. */
export function exceptionGuide(type: string, message: string): Guide {
  const name = type.split('.').at(-1) ?? type;
  const guides: Record<string, Guide> = {
    ArrayIndexOutOfBoundsException: { meaning: 'The code used an index outside the array. An array of length n has indexes 0 to n − 1.', causes: ['A loop condition with <= instead of <.', 'An index computed as length instead of length − 1.', 'A negative index, for example i − 1 when i is 0.'] },
    StringIndexOutOfBoundsException: { meaning: 'The code asked for a character or substring position outside the String. Valid positions are 0 to length() − 1.', causes: ['charAt(s.length()) instead of charAt(s.length() − 1).', 'substring with an end index past the length, or a start after the end.'] },
    IndexOutOfBoundsException: { meaning: 'The code used an index outside a list. A list of size n has indexes 0 to n − 1.', causes: ['A loop that runs while i <= list.size().', 'Reading get(0) from an empty list.', 'Removing items while looping forward by index, which shifts later items left.'] },
    NullPointerException: { meaning: 'The code used a reference that pointed to no object (null), for example by calling a method on it.', causes: ['A field or array element that was never assigned an object.', 'A method such as Map.get that returned null because the key was missing.', 'An object created later than the line that uses it.'] },
    ArithmeticException: { meaning: /zero/.test(message) ? 'An integer was divided by zero (or % zero). With int and long values this is an error; with double it gives Infinity or NaN instead.' : 'An arithmetic operation could not produce a result.', causes: ['A divisor that can be 0, such as a count of items in an empty list.', 'A computed divisor, such as n / 2 when n is 1.'] },
    NumberFormatException: { meaning: 'Text was converted to a number, but it wasn\u2019t a valid number in that format.', causes: ['Spaces around the number: use trim() first.', 'A decimal such as "2.5" passed to Integer.parseInt.', 'An empty line, which happens after nextInt() followed by nextLine().'] },
    InputMismatchException: { meaning: 'A Scanner method such as nextInt() found a token that isn\u2019t the type it reads.', causes: ['The input has text where the program expects a number.', 'The program reads values in a different order than the input provides them.'] },
    NoSuchElementException: { meaning: 'The program asked for more input (or the next item of an iterator) than there was.', causes: ['The input has fewer lines or numbers than the program reads. Check the Input tab.', 'A loop that calls next() without checking hasNext().'] },
    ConcurrentModificationException: { meaning: 'A collection changed while a for-each loop (an iterator) was walking through it.', causes: ['Calling list.remove or list.add inside for (x : list). Use an Iterator\u2019s remove(), removeIf, or loop backward by index.'] },
    ClassCastException: { meaning: 'A cast asked Java to treat an object as a type it isn\u2019t.', causes: ['Casting an object to the wrong subclass. Check its actual type with instanceof first.', 'Mixing types in a collection without generics, so a String is read as an Integer.'] },
    NegativeArraySizeException: { meaning: 'An array was created with a negative length.', causes: ['A size computed from input or a subtraction that can go below zero.'] },
    UnsupportedOperationException: { meaning: 'The collection doesn\u2019t allow this change.', causes: ['List.of(...), Set.of(...) and Map.of(...) create unmodifiable collections. Copy one first: new ArrayList<>(List.of(...)).', 'Arrays.asList has a fixed size: add and remove fail.'] },
    IllegalArgumentException: { meaning: 'A method rejected an argument it can\u2019t accept.', causes: ['A value outside the allowed range, such as new Random().nextInt(0).', 'A check in the program\u2019s own code (look at the throw statement and its message).'] },
    IllegalStateException: { meaning: 'A method was called when the object wasn\u2019t ready for it.', causes: ['Using a Scanner after closing it.', 'Calling Iterator.remove() twice, or before next().'] },
    StackOverflowError: { meaning: 'Method calls nested too deeply, almost always because a recursive method kept calling itself.', causes: ['A base case that is missing or never reached.', 'A recursive call whose argument doesn\u2019t move toward the base case.'] },
    OutOfMemoryError: { meaning: 'The program created more objects than fit in memory (96 MiB here).', causes: ['A loop that keeps adding to a list without ending.', 'An array sized from a very large number.'] },
    ArrayStoreException: { meaning: 'An object of the wrong type was stored into an array.', causes: ['Storing a value in an Object[] that is really a String[].'] },
  };
  return guides[name] ?? { meaning: `The program threw ${name}${message ? `: ${message}` : ''}.`, causes: ['Read the message, then step back from the exception to see the values that led to it.'] };
}

