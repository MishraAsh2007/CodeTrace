// The python branch's self-check cases (frontend/scripts/check-questions.ts), run by scripts/test.mjs on
// TraceLab's runner: the concepts each program must get questions about, or "ai" when the bank has none.
import { SAMPLES } from '../web/pyquiz/samples.ts';

const BST_OK =
  "class Node:\n    def __init__(self, val):\n        self.val = val\n        self.left = None\n        self.right = None\n\n" +
  "def insert(root, val):\n    if root is None:\n        return Node(val)\n    if val < root.val:\n        root.left = insert(root.left, val)\n" +
  "    else:\n        root.right = insert(root.right, val)\n    return root\n\nroot = None\nfor v in [5, 2, 8, 1]:\n    root = insert(root, v)\nprint(root.left.left.val)\n";

export const CASES = [
  // Samples
  { name: 'sample: linked list (bug)', code: SAMPLES.linked_list.code, expect: 'local', concepts: ['none-pointer', 'pointers'] },
  { name: 'sample: BST insert (bug)', code: SAMPLES.bst.code, expect: 'local', concepts: ['none-pointer', 'recursion-return'] },
  { name: 'sample: reverse list', code: SAMPLES.reverse.code, expect: 'local', concepts: ['pointers'] },
  { name: 'sample: factorial', code: SAMPLES.recursion.code, expect: 'local', concepts: ['recursion-depth'] },
  { name: 'working BST', code: BST_OK, expect: 'local', concepts: ['branching'] },

  // Data structures & algorithms
  {
    name: 'DFS (recursive)',
    code:
      "graph = {'a': ['b', 'c'], 'b': ['d'], 'c': ['d'], 'd': []}\n\ndef dfs(node, visited):\n    visited.add(node)\n" +
      '    for n in graph[node]:\n        if n not in visited:\n            dfs(n, visited)\n    return visited\n\nprint(sorted(dfs(\'a\', set())))\n',
    expect: 'local',
    concepts: ['graph-order', 'graph-kind', 'graph-visited', 'graph-cost'],
  },
  {
    name: 'BFS (deque)',
    code:
      "from collections import deque\n\ngraph = {'a': ['b', 'c'], 'b': ['d'], 'c': ['e'], 'd': [], 'e': ['a']}\n\ndef bfs(start):\n" +
      '    seen = {start}\n    order = []\n    q = deque([start])\n    while q:\n        node = q.popleft()\n        order.append(node)\n' +
      "        for n in graph[node]:\n            if n not in seen:\n                seen.add(n)\n                q.append(n)\n    return order\n\nprint(bfs('a'))\n",
    expect: 'local',
    concepts: ['graph-kind', 'graph-visited', 'stack-queue'],
  },
  {
    name: 'bubble sort',
    code:
      'def bubble(a):\n    n = len(a)\n    for i in range(n):\n        for j in range(n - 1 - i):\n            if a[j] > a[j + 1]:\n' +
      '                a[j], a[j + 1] = a[j + 1], a[j]\n    return a\n\nprint(bubble([5, 1, 4, 2, 8]))\n',
    expect: 'local',
    concepts: ['sort-pass', 'sort-comparisons'],
  },
  {
    name: 'binary search',
    code:
      'def search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n' +
      '            return mid\n        if arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n\n' +
      'print(search([1, 3, 5, 7, 9, 11, 13], 11))\n',
    expect: 'local',
    concepts: ['binary-search', 'binary-search-steps'],
  },
  { name: 'naive fibonacci', code: 'def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(fib(5))\n', expect: 'local', concepts: ['repeated-work', 'memoization'] },
  {
    name: 'memoized fibonacci',
    code: 'memo = {}\n\ndef fib(n):\n    if n in memo:\n        return memo[n]\n    if n < 2:\n        return n\n    memo[n] = fib(n - 1) + fib(n - 2)\n    return memo[n]\n\nprint(fib(6))\n',
    expect: 'local',
    concepts: ['memoization'],
  },
  { name: 'stack', code: 'stack = []\nfor x in [1, 2, 3]:\n    stack.append(x)\ntop = stack.pop()\nprint(top, stack)\n', expect: 'local', concepts: ['stack-queue'] },
  { name: 'heap', code: 'import heapq\nh = []\nfor x in [7, 2, 9, 4]:\n    heapq.heappush(h, x)\nlow = heapq.heappop(h)\nprint(low)\n', expect: 'local', concepts: ['stack-queue'] },
  { name: 'word count', code: "words = 'the cat and the hat and the bat'.split()\ncounts = {}\nfor w in words:\n    counts[w] = counts.get(w, 0) + 1\nprint(counts)\n", expect: 'local', concepts: ['dict-counting'] },

  // Efficiency
  {
    name: 'dedupe with list (O(n^2))',
    code: 'nums = [3, 1, 3, 2, 1, 4, 2]\nresult = []\nfor x in nums:\n    if x not in result:\n        result.append(x)\nprint(result)\n',
    expect: 'local',
    concepts: ['list-membership'],
  },
  {
    name: 'two-sum nested loops',
    code: 'nums = [2, 7, 11, 15, 1]\nfound = None\nfor i in range(len(nums)):\n    for j in range(i + 1, len(nums)):\n        if nums[i] + nums[j] == 16:\n            found = (i, j)\nprint(found)\n',
    expect: 'local',
    concepts: ['nested-loops'],
  },
  { name: 'queue with pop(0)', code: 'q = [1, 2, 3, 4]\ntotal = 0\nwhile q:\n    x = q.pop(0)\n    total += x\nprint(total)\n', expect: 'local', concepts: ['list-pop-front', 'stack-queue'] },
  { name: 'string building', code: "s = ''\nfor ch in 'hello':\n    s += ch.upper()\nprint(s)\n", expect: 'local', concepts: ['string-building'] },

  // Python basics
  { name: 'mutable default', code: 'def add(x, items=[]):\n    items.append(x)\n    return items\n\nprint(add(1))\nprint(add(2))\n', expect: 'local', concepts: ['mutable-default'] },
  { name: 'returns None (no crash)', code: 'def double_all(xs):\n    out = [x * 2 for x in xs]\n    print(out)\n\nresult = double_all([1, 2])\nprint(result)\n', expect: 'local', concepts: ['returns-none'] },
  { name: 'true division', code: 'total = 7\ncount = 2\navg = total / count\nprint(avg)\n', expect: 'local', concepts: ['division'] },
  { name: 'slicing', code: "letters = ['a', 'b', 'c', 'd', 'e']\npart = letters[1:3]\nprint(part)\n", expect: 'local', concepts: ['slicing'] },
  { name: 'aliasing', code: 'a = [1, 2, 3]\nb = a\nb.append(4)\nprint(a)\n', expect: 'local', concepts: ['aliasing'] },

  // Bugs
  { name: 'index off by one', code: 'nums = [3, 1, 4]\ntotal = 0\nfor i in range(len(nums) + 1):\n    total += nums[i]\nprint(total)\n', expect: 'local', concepts: ['list-bounds'] },
  { name: 'infinite while', code: 'i = 0\nwhile i < 5:\n    print(i)\n', expect: 'local', concepts: ['loop-termination'] },
  { name: 'no base case', code: 'def count(n):\n    return count(n - 1)\n\ncount(5)\n', expect: 'local', concepts: ['recursion'] },
  { name: 'zero division', code: 'scores = []\ntotal = sum(scores)\ncount = len(scores)\navg = total / count\nprint(avg)\n', expect: 'local', concepts: ['division-by-zero'] },
  { name: 'dict counting bug', code: "words = ['a', 'b', 'a']\ncounts = {}\nfor w in words:\n    counts[w] += 1\nprint(counts)\n", expect: 'local', concepts: ['dict-missing-key'] },
  { name: 'name typo', code: 'total = 5\nprint(totl)\n', expect: 'local', concepts: ['names'] },
  { name: 'int of decimal', code: "price = int('3.50')\nprint(price)\n", expect: 'local', concepts: ['parsing-input'] },
  { name: 'list.push', code: 'class Stack:\n    def __init__(self):\n        self.items = []\n\ns = Stack()\ns.items.push(3)\nprint(s.items)\n', expect: 'local', concepts: ['list-methods'] },
  { name: 'unbound local', code: 'count = 0\n\ndef inc():\n    count += 1\n\ninc()\nprint(count)\n', expect: 'local', concepts: ['scope'] },
  { name: 'str item assignment', code: "s = 'cat'\ns[0] = 'b'\nprint(s)\n", expect: 'local', concepts: ['string-immutable'] },
  { name: 'for over int', code: 'n = 3\nfor i in n:\n    print(i)\n', expect: 'local', concepts: ['loops'] },
  { name: 'None subscript', code: 'def first_two(xs):\n    part = xs[:2]\n\nr = first_two([5, 6, 7])\nprint(r[0])\n', expect: 'local', concepts: ['returns-none'] },
  { name: 'missing argument', code: 'def add(a, b):\n    return a + b\n\nprint(add(1))\n', expect: 'local', concepts: ['arguments'] },
  { name: 'assert', code: 'def area(w, h):\n    return w + h\n\nresult = area(2, 3)\nassert result == 6\n', expect: 'local', concepts: ['assertions'] },
  { name: 'ValueError (generic)', code: 'x = [1, 2, 3]\nx.remove(9)\n', expect: 'local', concepts: ['error-types'] },

  // Syntax errors (no trace)
  { name: 'missing colon', code: 'x = 3\nif x > 1\n    print(x)\n', expect: 'local', concepts: ['syntax'] },
  { name: '= instead of ==', code: 'x = 3\nif x = 3:\n    print(x)\n', expect: 'local', concepts: ['syntax'] },
  { name: 'unclosed paren', code: 'print((1 + 2)\nx = 1\n', expect: 'local', concepts: ['syntax'] },
  { name: 'missing indent', code: 'if True:\nprint(1)\n', expect: 'local', concepts: ['indentation'] },

  // Nothing to quiz on
  { name: 'hello world', code: "print('hello')\n", expect: 'ai' },
];
