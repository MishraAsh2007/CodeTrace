import type { Project } from './types';

export const examples: Project[] = [
  {
    version: 1, name: 'The extra iteration', example: 'bounds', mainClass: 'Main', stdin: '3\n4 7 2', maxSteps: 500,
    files: [
      { name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        int size = input.nextInt();
        int[] values = new int[size];
        for (int i = 0; i < size; i++) {
            values[i] = input.nextInt();
        }

        int result = ArraySum.sum(values);
        System.out.println(result);
    }
}
` },
      { name: 'ArraySum.java', content: `public class ArraySum {
    public static int sum(int[] values) {
        int total = 0;

        // Can this loop take one step too far?
        for (int i = 0; i <= values.length; i++) {
            total += values[i];
        }

        return total;
    }
}
` },
    ],
    checks: [
      { name: 'Three values', stdin: '3\n4 7 2', expectedOutput: '13' },
      { name: 'Empty array', stdin: '0', expectedOutput: '0' },
      { name: 'Single value', stdin: '1\n9', expectedOutput: '9' },
      { name: 'Negative values', stdin: '3\n-5 1 1', expectedOutput: '-3' },
    ],
  },
  {
    version: 1, name: 'One object, two names', example: 'aliasing', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [
      { name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        Box first = new Box(7);
        Box second = first;

        second.value = 42;

        System.out.println(first.value);
    }
}
` },
      { name: 'Box.java', content: `public class Box {
    public int value;

    public Box(int value) {
        this.value = value;
    }
}
` },
    ], checks: [{ name: 'Shared reference', stdin: '', expectedOutput: '42' }],
  },
  {
    version: 1, name: 'Inside recursion', example: 'recursion', mainClass: 'Main', stdin: '', maxSteps: 500,
    files: [{ name: 'Main.java', content: `public class Main {
    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }

        int smaller = factorial(n - 1);
        int result = n * smaller;
        return result;
    }

    public static void main(String[] args) {
        int answer = factorial(5);
        System.out.println(answer);
    }
}
` }], checks: [{ name: 'Factorial of five', stdin: '', expectedOutput: '120' }],
  },
  {
    version: 1, name: 'A growing list', example: 'collections', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList<String> names = new ArrayList<>();
        names.add("Ada");
        names.add("Grace");
        names.set(0, "Linus");
        System.out.println(names.size());
    }
}
` }], checks: [{ name: 'Two entries', stdin: '', expectedOutput: '2' }],
  },
  {
    version: 1, name: 'The loop that stays', example: 'loop', mainClass: 'Main', stdin: '', maxSteps: 100,
    files: [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        int count = 0;
        while (count < 3) {
            // What changes the loop condition?
            System.out.println(count);
        }
    }
}
` }], checks: [{ name: 'Three iterations', stdin: '', expectedOutput: '0\n1\n2' }],
  },
  {
    version: 1, name: 'Same text, different objects', example: 'strings', mainClass: 'Main', stdin: 'yes', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        String answer = input.next();
        String expected = "yes";

        // Do these two names refer to the same object?
        if (answer == expected) {
            System.out.println("Confirmed");
        } else {
            System.out.println("Not confirmed");
        }
    }
}
` }],
    checks: [
      { name: 'Typed yes', stdin: 'yes', expectedOutput: 'Confirmed' },
      { name: 'Typed no', stdin: 'no', expectedOutput: 'Not confirmed' },
      { name: 'Different case', stdin: 'YES', expectedOutput: 'Not confirmed' },
    ],
  },
  {
    version: 1, name: 'Counting words', example: 'counts', mainClass: 'Main', stdin: 'the cat the', maxSteps: 400,
    files: [{ name: 'Main.java', content: `import java.util.HashMap;
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        HashMap<String, Integer> counts = new HashMap<>();

        while (input.hasNext()) {
            String word = input.next();
            // What does get return for a word we have not seen yet?
            counts.put(word, counts.get(word) + 1);
        }

        System.out.println(counts.get("the"));
    }
}
` }],
    checks: [
      { name: 'Repeated word', stdin: 'the cat the', expectedOutput: '2' },
      { name: 'One word', stdin: 'the', expectedOutput: '1' },
      { name: 'Word not present', stdin: 'a cat', expectedOutput: 'null' },
    ],
  },
  {
    version: 1, name: 'Walking a chain', example: 'nodes', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [
      { name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        Node head = new Node(1, new Node(2, new Node(3, null)));

        int total = 0;
        Node current = head;
        while (current != null) {
            total += current.value;
            current = current.next;
        }

        System.out.println(total);
    }
}
` },
      { name: 'Node.java', content: `public class Node {
    int value;
    Node next;

    Node(int value, Node next) {
        this.value = value;
        this.next = next;
    }
}
` },
    ],
    checks: [{ name: 'Sum of the chain', stdin: '', expectedOutput: '6' }],
  },
];

examples.push(
  {
    version: 1, name: 'Average of no scores', example: 'divide', mainClass: 'Main', stdin: '0', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        int count = input.nextInt();
        int total = 0;
        for (int i = 0; i < count; i++) {
            total += input.nextInt();
        }

        // What happens when there are no scores?
        int average = total / count;
        System.out.println(average);
    }
}
` }],
    checks: [
      { name: 'Three scores', stdin: '3\n90 80 70', expectedOutput: '80' },
      { name: 'No scores', stdin: '0', expectedOutput: '0' },
      { name: 'One score', stdin: '1\n55', expectedOutput: '55' },
    ],
  },
  {
    version: 1, name: 'The average that rounds down', example: 'intdiv', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        int[] scores = {90, 85, 72, 88};
        int total = 0;
        for (int score : scores) {
            total += score;
        }

        // Why does the average lose its decimal part?
        double average = total / scores.length;
        System.out.println(average);
    }
}
` }],
    checks: [{ name: 'Exact average', stdin: '', expectedOutput: '83.75' }],
  },
  {
    version: 1, name: 'The swap that didn’t', example: 'swap', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `public class Main {
    static void swap(int a, int b) {
        int temp = a;
        a = b;
        b = temp;
    }

    public static void main(String[] args) {
        int x = 1;
        int y = 2;
        swap(x, y);
        System.out.println(x + " " + y);
    }
}
` }],
    checks: [{ name: 'Values swapped', stdin: '', expectedOutput: '2 1' }],
  },
  {
    version: 1, name: 'Copy or alias?', example: 'copy', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] original = {3, 1, 2};
        int[] sorted = original;
        Arrays.sort(sorted);

        // Did sorting the copy change the original?
        System.out.println(Arrays.toString(original) + " " + Arrays.toString(sorted));
    }
}
` }],
    checks: [{ name: 'Original keeps its order', stdin: '', expectedOutput: '[3, 1, 2] [1, 2, 3]' }],
  },
  {
    version: 1, name: 'Removing while looping', example: 'removal', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>(List.of("Al", "Bob", "Cy", "Dee"));

        // Remove every name shorter than three letters.
        for (String name : names) {
            if (name.length() < 3) {
                names.remove(name);
            }
        }

        System.out.println(names);
    }
}
` }],
    checks: [{ name: 'Short names removed', stdin: '', expectedOutput: '[Bob, Dee]' }],
  },
  {
    version: 1, name: 'A price with cents', example: 'parse', mainClass: 'Main', stdin: '4.50', maxSteps: 300,
    files: [{ name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        String line = input.nextLine();

        // The user typed a price with cents.
        int price = Integer.parseInt(line);
        System.out.println(price * 2);
    }
}
` }],
    checks: [
      { name: 'Price with cents', stdin: '4.50', expectedOutput: '9.0' },
      { name: 'Whole price', stdin: '3', expectedOutput: '6.0' },
    ],
  },
  {
    version: 1, name: 'One character too far', example: 'palindrome', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        String word = "level";
        boolean palindrome = true;

        // Compare characters from both ends.
        for (int i = 0; i < word.length() / 2; i++) {
            char left = word.charAt(i);
            char right = word.charAt(word.length() - i);
            if (left != right) {
                palindrome = false;
            }
        }

        System.out.println(palindrome);
    }
}
` }],
    checks: [{ name: 'A palindrome', stdin: '', expectedOutput: 'true' }],
  },
  {
    version: 1, name: 'Recursion with no way out', example: 'sumto', mainClass: 'Main', stdin: '', maxSteps: 200,
    files: [{ name: 'Main.java', content: `public class Main {
    // Adds n + (n - 1) + ... + 1.
    static int sumTo(int n) {
        return n + sumTo(n - 1);
    }

    public static void main(String[] args) {
        System.out.println(sumTo(4));
    }
}
` }],
    checks: [{ name: 'Sum to four', stdin: '', expectedOutput: '10' }],
  },
  {
    version: 1, name: 'The list that was never created', example: 'library', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [
      { name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        Library library = new Library();
        library.add("Dune");
        library.add("Emma");
        System.out.println(library.count());
    }
}
` },
      { name: 'Library.java', content: `import java.util.ArrayList;

public class Library {
    private ArrayList<String> books;

    public void add(String title) {
        // Which object does books refer to?
        books.add(title);
    }

    public int count() {
        return books.size();
    }
}
` },
    ],
    checks: [{ name: 'Two books', stdin: '', expectedOutput: '2' }],
  },
  {
    version: 1, name: 'Half of seven', example: 'lossy', mainClass: 'Main', stdin: '', maxSteps: 300,
    files: [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        int total = 7;

        // Half of seven, please.
        int half = total / 2.0;
        System.out.println(half);
    }
}
` }],
    checks: [{ name: 'Exact half', stdin: '', expectedOutput: '3.5' }],
  },
);

// Algorithm tours: data structures drawn from the recording (the tree view, queues, visited arrays, the call stack).
examples.push(
  {
    version: 1, name: 'Binary search tree', example: 'bst', mainClass: 'Main', stdin: '', maxSteps: 500,
    files: [
      { name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        Node root = null;
        int[] values = {50, 30, 70, 20, 40, 60, 80};
        for (int value : values) {
            root = Node.insert(root, value);
        }

        StringBuilder sorted = new StringBuilder();
        Node.inOrder(root, sorted);
        System.out.println(sorted.toString().trim());
        System.out.println(Node.contains(root, 60) + " " + Node.contains(root, 65));
    }
}
` },
      { name: 'Node.java', content: `public class Node {
    int value;
    Node left;
    Node right;

    Node(int value) {
        this.value = value;
    }

    /** Smaller values go left, larger or equal values go right. */
    static Node insert(Node node, int value) {
        if (node == null) {
            return new Node(value);
        }
        if (value < node.value) {
            node.left = insert(node.left, value);
        } else {
            node.right = insert(node.right, value);
        }
        return node;
    }

    /** Left subtree, then the node, then the right subtree: values come out sorted. */
    static void inOrder(Node node, StringBuilder out) {
        if (node == null) {
            return;
        }
        inOrder(node.left, out);
        out.append(node.value).append(' ');
        inOrder(node.right, out);
    }

    static boolean contains(Node node, int value) {
        while (node != null) {
            if (value == node.value) {
                return true;
            }
            node = value < node.value ? node.left : node.right;
        }
        return false;
    }
}
` },
    ],
    checks: [{ name: 'Sorted and searched', stdin: '', expectedOutput: '20 30 40 50 60 70 80\ntrue false' }],
  },
  {
    version: 1, name: 'Breadth-first search', example: 'bfs', mainClass: 'Main', stdin: '', maxSteps: 500,
    files: [{ name: 'Main.java', content: `import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Queue;

public class Main {
    public static void main(String[] args) {
        // An undirected graph: 0-1, 0-2, 1-3, 2-3, 3-4.
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {2, 3}, {3, 4}};
        List<List<Integer>> neighbors = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            neighbors.add(new ArrayList<>());
        }
        for (int[] edge : edges) {
            neighbors.get(edge[0]).add(edge[1]);
            neighbors.get(edge[1]).add(edge[0]);
        }

        // Visit nodes in rings around the start; dist[n] is the number of edges from 0.
        int[] dist = new int[5];
        Arrays.fill(dist, -1);
        Queue<Integer> queue = new ArrayDeque<>();
        dist[0] = 0;
        queue.add(0);
        while (!queue.isEmpty()) {
            int node = queue.remove();
            for (int next : neighbors.get(node)) {
                if (dist[next] == -1) {
                    dist[next] = dist[node] + 1;
                    queue.add(next);
                }
            }
        }
        System.out.println(Arrays.toString(dist));
    }
}
` }],
    checks: [{ name: 'Distances from node 0', stdin: '', expectedOutput: '[0, 1, 1, 2, 3]' }],
  },
  {
    version: 1, name: 'Depth-first search', example: 'dfs', mainClass: 'Main', stdin: '', maxSteps: 500,
    files: [{ name: 'Main.java', content: `public class Main {
    static int[][] graph = {
        {1, 2},  // 0
        {3},     // 1
        {3},     // 2
        {4},     // 3
        {},      // 4
    };
    static boolean[] visited = new boolean[graph.length];
    static StringBuilder order = new StringBuilder();

    /** Goes as deep as possible before backing up; the call stack remembers the way back. */
    static void visit(int node) {
        visited[node] = true;
        order.append(node).append(' ');
        for (int next : graph[node]) {
            if (!visited[next]) {
                visit(next);
            }
        }
    }

    public static void main(String[] args) {
        visit(0);
        System.out.println(order.toString().trim());
    }
}
` }],
    checks: [{ name: 'Visit order from node 0', stdin: '', expectedOutput: '0 1 3 4 2' }],
  },
);

export type DemoCategory = 'runtime' | 'output' | 'hang' | 'compile' | 'tour';
export type Demo = {
  id: string; category: DemoCategory;
  /** What the student sees go wrong, e.g. an exception name. */
  symptom: string;
  summary: string;
  /** The line(s) at the heart of the demo, shown in gallery cards. */
  snippet: string;
  concepts: string[];
  level: 'Beginner' | 'Intermediate';
};

export const categories: { id: DemoCategory; label: string; description: string }[] = [
  { id: 'runtime', label: 'Runtime errors', description: 'The program compiles, then the JVM throws an exception.' },
  { id: 'output', label: 'Wrong output', description: 'No crash, but the result does not match the test cases.' },
  { id: 'hang', label: 'Never finishes', description: 'The program runs until TraceLab’s step budget stops it.' },
  { id: 'compile', label: 'Compile errors', description: 'javac rejects the program before it can run.' },
  { id: 'tour', label: 'Concept tours', description: 'Working programs that show how Java memory behaves.' },
];

/** Gallery order and descriptions. Every buggy demo has checks that its repaired version passes. */
export const demos: Demo[] = [
  { id: 'bounds', category: 'runtime', symptom: 'ArrayIndexOutOfBoundsException', summary: 'A two-file program sums an array, and the loop runs one step past the end.', snippet: 'for (int i = 0; i <= values.length; i++)', concepts: ['Arrays', 'Loops', 'Off-by-one'], level: 'Beginner' },
  { id: 'library', category: 'runtime', symptom: 'NullPointerException', summary: 'A class declares a list field but never creates the list.', snippet: 'private ArrayList<String> books;', concepts: ['Objects', 'Fields', 'null'], level: 'Beginner' },
  { id: 'counts', category: 'runtime', symptom: 'NullPointerException', summary: 'A word counter adds 1 to a value that is not in the map yet.', snippet: 'counts.put(word, counts.get(word) + 1);', concepts: ['HashMap', 'Unboxing', 'null'], level: 'Intermediate' },
  { id: 'divide', category: 'runtime', symptom: 'ArithmeticException', summary: 'An average works for real input, then fails when there are no scores.', snippet: 'int average = total / count;', concepts: ['Integer arithmetic', 'Edge cases'], level: 'Beginner' },
  { id: 'palindrome', category: 'runtime', symptom: 'StringIndexOutOfBoundsException', summary: 'A palindrome check reads one character past the end of the word.', snippet: 'word.charAt(word.length() - i)', concepts: ['Strings', 'Indexing'], level: 'Beginner' },
  { id: 'parse', category: 'runtime', symptom: 'NumberFormatException', summary: 'A price typed with cents is parsed as a whole number.', snippet: 'int price = Integer.parseInt(line);', concepts: ['Input', 'Parsing', 'Types'], level: 'Beginner' },
  { id: 'removal', category: 'runtime', symptom: 'ConcurrentModificationException', summary: 'A for-each loop removes elements from the list it is iterating over.', snippet: 'for (String name : names) { … names.remove(name); }', concepts: ['ArrayList', 'Iterators'], level: 'Intermediate' },
  { id: 'strings', category: 'output', symptom: 'Prints “Not confirmed”', summary: 'Two strings with the same text are compared with ==.', snippet: 'if (answer == expected)', concepts: ['Strings', 'Identity vs. equality'], level: 'Beginner' },
  { id: 'intdiv', category: 'output', symptom: 'Prints 83.0, expected 83.75', summary: 'An average is stored in a double but computed with integer division.', snippet: 'double average = total / scores.length;', concepts: ['Integer division', 'Types'], level: 'Beginner' },
  { id: 'swap', category: 'output', symptom: 'Prints “1 2”, expected “2 1”', summary: 'A swap method changes its own copies of the values.', snippet: 'swap(x, y);', concepts: ['Methods', 'Pass by value'], level: 'Beginner' },
  { id: 'copy', category: 'output', symptom: 'The original array changes', summary: 'Sorting a “copy” also sorts the original, because both names refer to one array.', snippet: 'int[] sorted = original;', concepts: ['Arrays', 'References', 'Aliasing'], level: 'Intermediate' },
  { id: 'loop', category: 'hang', symptom: 'Step budget reached', summary: 'A while loop prints forever because nothing changes its condition.', snippet: 'while (count < 3) { System.out.println(count); }', concepts: ['Loops', 'Termination'], level: 'Beginner' },
  { id: 'sumto', category: 'hang', symptom: 'Unbounded recursion', summary: 'A recursive sum keeps calling itself because it has no base case.', snippet: 'return n + sumTo(n - 1);', concepts: ['Recursion', 'Base cases'], level: 'Intermediate' },
  { id: 'lossy', category: 'compile', symptom: 'incompatible types', summary: 'A double result is stored in an int variable.', snippet: 'int half = total / 2.0;', concepts: ['Types', 'Compiler errors'], level: 'Beginner' },
  { id: 'aliasing', category: 'tour', symptom: 'Working program', summary: 'Two variables refer to one object; a change through one is visible through the other.', snippet: 'Box second = first;', concepts: ['Objects', 'References'], level: 'Beginner' },
  { id: 'recursion', category: 'tour', symptom: 'Working program', summary: 'Watch factorial’s frames stack up, then return in reverse order.', snippet: 'int smaller = factorial(n - 1);', concepts: ['Recursion', 'Call stack'], level: 'Beginner' },
  { id: 'nodes', category: 'tour', symptom: 'Working program', summary: 'Follow a linked chain of nodes with reference arrows.', snippet: 'current = current.next;', concepts: ['Linked lists', 'References'], level: 'Intermediate' },
  { id: 'collections', category: 'tour', symptom: 'Working program', summary: 'An ArrayList grows and changes in place.', snippet: 'names.set(0, "Linus");', concepts: ['ArrayList'], level: 'Beginner' },
  { id: 'bst', category: 'tour', symptom: 'Working program', summary: 'Build a binary search tree, drawn as a tree, then read it back in sorted order.', snippet: 'node.left = insert(node.left, value);', concepts: ['Binary trees', 'Recursion'], level: 'Intermediate' },
  { id: 'bfs', category: 'tour', symptom: 'Working program', summary: 'Breadth-first search with a queue finds how many edges each node is from the start.', snippet: 'int node = queue.remove();', concepts: ['Graphs', 'Queues', 'BFS'], level: 'Intermediate' },
  { id: 'dfs', category: 'tour', symptom: 'Working program', summary: 'Depth-first search follows one path as far as it goes; the call stack remembers the way back.', snippet: 'visit(next);', concepts: ['Graphs', 'Recursion', 'DFS'], level: 'Intermediate' },
];

/** Examples that intentionally contain a bug for the learning loop. */
export const buggyExamples = new Set(demos.filter(d => d.category !== 'tour').map(d => d.id));

export function demoFor(id: string): Demo | undefined { return demos.find(d => d.id === id); }
export function exampleIndex(id: string): number { return examples.findIndex(p => p.example === id); }
export function copyExample(index = 0): Project { return structuredClone(examples[index]); }
