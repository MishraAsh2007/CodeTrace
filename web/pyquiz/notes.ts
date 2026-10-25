// notes.ts: short built-in explanations for "what is X?" questions typed into the chat,
// so common definitions work offline, without an AI call. Matching is deliberately conservative:
// it only answers when the message reads like a definition question AND names a known concept.

interface Note {
  aliases: string[];
  title: string;
  text: string;
}

const NOTES: Note[] = [
  { aliases: ["dfs", "depth first", "depth-first"], title: "Depth-first search", text: "DFS explores one path as far as it can before backing up. It uses a stack: either recursion (the call stack) or a list with `append`/`pop()`. A `visited` set makes each node count once, so the cost is O(V + E)." },
  { aliases: ["bfs", "breadth first", "breadth-first"], title: "Breadth-first search", text: "BFS visits every neighbor of a node before going one level further, using a queue (`collections.deque` with `append`/`popleft()`). In an unweighted graph it finds the shortest path. Cost: O(V + E)." },
  { aliases: ["graph traversal", "adjacency list", "graph"], title: "Graphs", text: "A graph is nodes connected by edges. An adjacency list stores it as a dict: each node maps to a list of its neighbors, e.g. `{'a': ['b', 'c']}`. Traversals (DFS, BFS) need a `visited` set so cycles don't loop forever." },
  { aliases: ["recursion", "recursive"], title: "Recursion", text: "A recursive function calls itself on a smaller version of the problem. It needs a base case that returns without recursing. Each call gets its own frame on the call stack, which is what the frame cards in the diagram show." },
  { aliases: ["base case"], title: "Base case", text: "The case a recursive function answers directly, without calling itself, like `if n <= 1: return 1`. Without one (or if it's never reached), the calls never unwind." },
  { aliases: ["call stack", "stack frame", "frame"], title: "Call stack", text: "Every function call gets a frame holding its local variables. Frames stack up as calls nest and are removed when each call returns. In the diagram, the highlighted frame is the one running now." },
  { aliases: ["linked list"], title: "Linked lists", text: "A chain of nodes. Each node holds a value and a reference (`next`) to the following node, and the last node's `next` is None. Walk it with `current = current.next` until `current is None`." },
  { aliases: ["binary search tree", "bst"], title: "Binary search trees", text: "In a BST, everything in a node's left subtree is smaller than it and everything on the right is larger. Search and insert go left or right at each node, taking O(height): about O(log n) when the tree is balanced." },
  { aliases: ["binary tree", "tree"], title: "Trees", text: "A tree is nodes with children (`left`/`right` in a binary tree) and no cycles. The top node is the root; nodes with no children are leaves. Recursion fits trees naturally: solve each subtree, then combine." },
  { aliases: ["stack", "lifo"], title: "Stacks", text: "A stack is last in, first out. In Python, use a list: `append(x)` pushes and `pop()` removes the most recently added item. Both are O(1)." },
  { aliases: ["queue", "fifo", "deque"], title: "Queues", text: "A queue is first in, first out. Use `collections.deque`: `append(x)` adds at the back and `popleft()` takes from the front, both O(1). `list.pop(0)` works but is O(n), because every other item shifts." },
  { aliases: ["heap", "priority queue", "heapq"], title: "Heaps", text: "`heapq` keeps a list as a min-heap: `heappush` adds in O(log n) and `heappop` always removes the smallest item in O(log n). It's the usual way to build a priority queue." },
  { aliases: ["big o", "big-o", "time complexity", "complexity", "o(n)", "o(n^2)", "o(n²)", "o(log n)", "runtime"], title: "Big-O", text: "Big-O describes how the work grows as the input size n grows, ignoring constant factors. O(1): constant. O(log n): halving each step (binary search). O(n): one pass. O(n log n): good sorting. O(n²): a loop inside a loop over the same data." },
  { aliases: ["space complexity", "memory usage"], title: "Space complexity", text: "Space complexity measures how much extra memory an algorithm uses as n grows. Recursion uses O(depth) stack space; building a new list of n items is O(n)." },
  { aliases: ["dictionary", "dict", "hash map", "hashmap", "hash table"], title: "Dictionaries", text: "A dict maps keys to values. Lookups and inserts take O(1) on average, thanks to hashing. `d[k]` raises KeyError for a missing key; `d.get(k, default)` returns a fallback, and `k in d` checks first." },
  { aliases: ["set", "sets"], title: "Sets", text: "A set holds unique items with no order. `x in s` takes O(1) on average (a list needs O(n)), so sets are the right tool for 'have I seen this?' checks like `visited`." },
  { aliases: ["binary search"], title: "Binary search", text: "Binary search works on sorted data: check the middle item, then keep only the half that could contain the target. Each step halves the range, so it takes O(log n): about 20 steps for a million items." },
  { aliases: ["bubble sort"], title: "Bubble sort", text: "Bubble sort repeatedly swaps neighboring items that are out of order. After pass k, the k largest items are in their final places. It makes about n²/2 comparisons: O(n²)." },
  { aliases: ["sorting", "sort", "sorted"], title: "Sorting", text: "Simple sorts (bubble, insertion, selection) use nested loops: O(n²). Merge sort and Python's built-in `sorted()` / `.sort()` (Timsort) take O(n log n). `sorted(x)` returns a new list; `x.sort()` sorts in place and returns None." },
  { aliases: ["memoization", "memoize", "memo", "dynamic programming", "dp", "cache", "lru_cache"], title: "Memoization", text: "Memoization saves the result of each subproblem (often in a dict) and reuses it, so each is computed once. It turns exponential recursions like naive Fibonacci into linear ones. `functools.lru_cache` does it automatically." },
  { aliases: ["none", "nonetype"], title: "None", text: "None is Python's 'no value'. A function without `return` gives back None, and the end of a linked list is a `next` that is None. Reading an attribute of None raises AttributeError: 'NoneType' object has no attribute ..." },
  { aliases: ["pointer", "reference", "references", "alias", "aliasing"], title: "References", text: "Python variables hold references to objects. `b = a` copies the reference, not the object, so both names see the same list or node. Use `a.copy()` or `list(a)` for an independent copy. The arrows in the diagram are references." },
  { aliases: ["mutable", "immutable"], title: "Mutable vs. immutable", text: "Lists, dicts, sets and your own objects are mutable: they can change in place. Ints, floats, strings and tuples are immutable: 'changing' them makes a new object." },
  { aliases: ["default argument", "mutable default", "default parameter"], title: "Default arguments", text: "A default like `def f(items=[])` is created once, when `def` runs, and shared by every call that doesn't pass `items`. Use `items=None` and `if items is None: items = []` inside the function." },
  { aliases: ["slicing", "slice"], title: "Slicing", text: "`a[start:stop:step]` takes items from `start` up to but not including `stop`. Missing parts default to the beginning and end; negative indices count from the end; `a[::-1]` reverses." },
  { aliases: ["list comprehension", "comprehension"], title: "List comprehensions", text: "`[expr for x in items if condition]` builds a new list in one expression. It's the same as a for loop that appends `expr` whenever the condition is True." },
  { aliases: ["range"], title: "range()", text: "`range(n)` produces 0, 1, …, n − 1. `range(a, b)` goes from a up to b − 1, and `range(a, b, s)` steps by s. The end is never included." },
  { aliases: ["floor division", "//", "integer division"], title: "/ vs //", text: "In Python 3, `/` always gives a float (`7 / 2` is 3.5, `4 / 2` is 2.0). `//` rounds down to a whole number (`7 // 2` is 3); use it for indices like `mid = (lo + hi) // 2`." },
  { aliases: ["global", "scope", "local variable", "unboundlocalerror"], title: "Scope", text: "Variables assigned inside a function are local to it. If a function assigns to a name, Python treats that name as local everywhere in the function, which causes UnboundLocalError if it's read first. Pass values in and return results, or use `global`." },
  { aliases: ["self"], title: "self", text: "`self` is the object a method was called on. Python passes it automatically: `s.push(3)` calls `push(s, 3)`. Use it to read and set the object's attributes, like `self.items`." },
  { aliases: ["class", "object", "instance"], title: "Classes and objects", text: "A class is a blueprint; each object (instance) made from it has its own attributes. `__init__` runs when an object is created and sets those attributes on `self`." },
  { aliases: ["return", "print vs return"], title: "return vs. print", text: "`return value` hands a value back to the caller and ends the function. `print` only shows text on screen. A function that prints but doesn't return gives back None." },
  { aliases: ["indexerror"], title: "IndexError", text: "IndexError means an index was outside the valid range. A sequence of length n has indices 0 through n − 1 (or −1 through −n from the end)." },
  { aliases: ["keyerror"], title: "KeyError", text: "KeyError means a dict was asked for a key it doesn't have. Check with `key in d`, or use `d.get(key, default)`." },
  { aliases: ["attributeerror"], title: "AttributeError", text: "AttributeError means the object has no attribute or method with that name. Often the object is None (check where it came from), or the method belongs to a different type (lists use `append`, not `push`)." },
  { aliases: ["typeerror"], title: "TypeError", text: "TypeError means an operation got a value of the wrong type, like adding a string to a number, calling a function with too few arguments, or indexing None." },
  { aliases: ["valueerror"], title: "ValueError", text: "ValueError means the type was right but the value wasn't usable, like `int('3.5')` or removing an item that isn't in the list." },
  { aliases: ["recursionerror", "stack overflow", "maximum recursion depth"], title: "RecursionError", text: "RecursionError means calls nested too deeply without returning, usually because the base case is missing or never reached." },
  { aliases: ["infinite loop"], title: "Infinite loops", text: "A loop runs forever when its condition never becomes False. Something in the body has to change the variables the condition depends on." },
  { aliases: ["two pointers", "two-pointer"], title: "Two pointers", text: "The two-pointer technique keeps two indices (often one at each end of a sorted list) and moves them toward each other, solving pair problems in O(n) instead of O(n²)." },
  { aliases: ["sliding window"], title: "Sliding window", text: "A sliding window keeps a running range [left, right] over a sequence and updates its total as the edges move, instead of recomputing each window: O(n) instead of O(n·k)." },
];

const QUESTION = /\b(what|what's|whats|explain|define|definition|meaning|mean|means|how does|how do|how is|difference|tell me about|why use|when (?:to|should|do) (?:i |we )?use)\b|\?\s*$/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A built-in explanation for a definition-style question, or null to send it to the AI tutor. */
export function answerFromNotes(message: string): { title: string; text: string } | null {
  const text = message.trim().toLowerCase();
  if (!text || text.split(/\s+/).length > 14 || !QUESTION.test(text)) return null;
  // Questions about *their* program ("why does my loop…", "line 12") need the AI's reasoning.
  if (/\b(my|line \d+|this code|my code|this program|bug|wrong|crash|error here|doesn'?t work|fix)\b/.test(text)) return null;
  let best: { note: Note; len: number } | null = null;
  for (const note of NOTES) {
    for (const alias of note.aliases) {
      const re = new RegExp(`(^|[^a-z0-9])${escape(alias)}($|[^a-z0-9])`);
      if (re.test(text) && (!best || alias.length > best.len)) best = { note, len: alias.length };
    }
  }
  return best ? { title: best.note.title, text: best.note.text } : null;
}
