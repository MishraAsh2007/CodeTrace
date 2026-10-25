import type { Check, Language, Project } from './types';

/**
 * Starting points for new projects. Templates with a specific program come with tests for that program, marked
 * as `template` tests: once the student writes something else, a failing template test says the test may be out
 * of date instead of calling the program wrong. The blank templates have no tests.
 */
export type Template = { id: string; name: string; description: string; icon: string; language: Language; create: (name: string) => Project };

const project = (name: string, files: Project['files'], extra: Partial<Project> = {}): Project =>
  ({ version: 1, name, example: '', mainClass: 'Main', stdin: '', maxSteps: 500, checks: [], files, ...extra });
const starter = (checks: Check[]): Check[] => checks.map(c => ({ ...c, origin: 'template' }));

export const templates: Template[] = [
  {
    id: 'blank', language: 'java', name: 'Blank program', icon: 'file-code-2', description: 'One Main class that prints a line. No tests until you add some.',
    create: name => project(name, [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, TraceLab!");
    }
}
` }]),
  },
  {
    id: 'input', language: 'java', name: 'Reads input', icon: 'keyboard', description: 'Reads numbers with Scanner. Tests supply the input.',
    create: name => project(name, [{ name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        int a = input.nextInt();
        int b = input.nextInt();
        System.out.println(a + b);
    }
}
` }], { stdin: '2 3', checks: starter([
      { name: 'Adds two numbers', stdin: '2 3', expectedOutput: '5' },
      { name: 'Negative numbers', stdin: '-4 1', expectedOutput: '-3' },
    ]) }),
  },
  {
    id: 'classes', language: 'java', name: 'Class + Main', icon: 'boxes', description: 'A Counter class used from Main, with a method test.',
    create: name => project(name, [
      { name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        Counter counter = new Counter();
        counter.increment();
        counter.increment();
        System.out.println(counter.getCount());
    }
}
` },
      { name: 'Counter.java', content: `public class Counter {
    private int count;

    public void increment() {
        count++;
    }

    public int getCount() {
        return count;
    }

    public static int twice(int n) {
        return n * 2;
    }
}
` },
    ], { checks: starter([
      { name: 'Counts two increments', stdin: '', expectedOutput: '2' },
      { name: 'twice(21)', stdin: '', expectedOutput: '42', kind: 'call', target: 'Counter', call: 'twice(21)' },
    ]) }),
  },
  {
    id: 'packages', language: 'java', name: 'Packages', icon: 'package', description: 'An app.Main class and an app.model.Book record in packages.',
    create: name => project(name, [
      { name: 'app/Main.java', content: `package app;

import app.model.Book;

public class Main {
    public static void main(String[] args) {
        Book book = new Book("Dune", 412);
        System.out.println(book.title() + " has " + book.pages() + " pages");
    }
}
` },
      { name: 'app/model/Book.java', content: `package app.model;

public record Book(String title, int pages) {
    public boolean isLong() {
        return pages > 300;
    }
}
` },
    ], { mainClass: 'app.Main', checks: starter([
      { name: 'Describes the book', stdin: '', expectedOutput: 'Dune has 412 pages' },
      { name: 'A long book', stdin: '', expectedOutput: 'true', kind: 'call', target: 'app.model.Book', call: 'new Book("Dune", 412).isLong()' },
    ]) }),
  },
  // C projects run in TraceLab's C interpreter, which supports a teaching subset of C (see the README).
  {
    id: 'c-blank', language: 'c', name: 'C program', icon: 'file-code-2', description: 'One main.c that prints a line. No tests until you add some.',
    create: name => project(name, [{ name: 'main.c', content: `#include <stdio.h>

int main(void) {
    printf("Hello, TraceLab!\\n");
    return 0;
}
` }], { language: 'c', mainClass: 'main' }),
  },
  {
    id: 'c-input', language: 'c', name: 'C: reads input', icon: 'keyboard', description: 'Reads two numbers with scanf. Tests supply the input.',
    create: name => project(name, [{ name: 'main.c', content: `#include <stdio.h>

int main(void) {
    int a;
    int b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}
` }], { language: 'c', mainClass: 'main', stdin: '2 3', checks: starter([
      { name: 'Adds two numbers', stdin: '2 3', expectedOutput: '5' },
      { name: 'Negative numbers', stdin: '-4 1', expectedOutput: '-3' },
    ]) }),
  },
  {
    id: 'c-list', language: 'c', name: 'C: linked list', icon: 'boxes', description: 'Nodes made with malloc, linked by pointers, drawn as a chain.',
    create: name => project(name, [{ name: 'main.c', content: `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

Node *push(Node *head, int value) {
    Node *node = malloc(sizeof(Node));
    node->value = value;
    node->next = head;
    return node;
}

int main(void) {
    Node *head = NULL;
    for (int i = 1; i <= 3; i++) {
        head = push(head, i * 10);
    }
    Node *current = head;
    while (current != NULL) {
        printf("%d ", current->value);
        current = current->next;
    }
    printf("\\n");
    return 0;
}
` }], { language: 'c', mainClass: 'main', checks: starter([{ name: 'Prints the list', stdin: '', expectedOutput: '30 20 10' }]) }),
  },
  // Python projects run under pg_logger (Online Python Tutor), which echoes each input() line into the output.
  {
    id: 'py-blank', language: 'python', name: 'Python program', icon: 'file-code-2', description: 'One main.py that prints a line. No tests until you add some.',
    create: name => project(name, [{ name: 'main.py', content: `print("Hello, TraceLab!")
` }], { language: 'python', mainClass: 'main', maxSteps: 1000 }),
  },
  {
    id: 'py-input', language: 'python', name: 'Python: reads input', icon: 'keyboard', description: 'Reads two numbers with input(). Tests supply the input.',
    create: name => project(name, [{ name: 'main.py', content: `a = int(input("First number: "))
b = int(input("Second number: "))
print(a + b)
` }], { language: 'python', mainClass: 'main', maxSteps: 1000, stdin: '2\n3', checks: starter([
      { name: 'Adds two numbers', stdin: '2\n3', expectedOutput: 'First number: 2\nSecond number: 3\n5' },
      { name: 'Negative numbers', stdin: '-4\n1', expectedOutput: 'First number: -4\nSecond number: 1\n-3' },
    ]) }),
  },
  {
    id: 'py-classes', language: 'python', name: 'Python: classes and lists', icon: 'boxes', description: 'A small class whose objects go into a list.',
    create: name => project(name, [{ name: 'main.py', content: `class Book:
    def __init__(self, title, pages):
        self.title = title
        self.pages = pages

    def is_long(self):
        return self.pages > 300


shelf = [Book("Dune", 412), Book("Emma", 240)]
long_books = [b.title for b in shelf if b.is_long()]
print(long_books)
` }], { language: 'python', mainClass: 'main', maxSteps: 1000, checks: starter([{ name: 'Finds the long books', stdin: '', expectedOutput: "['Dune']" }]) }),
  },
];

/** Tests that came with a template, including ones saved before tests recorded their origin. */
const LEGACY = new Set(['Prints a greeting|Hello, TraceLab!', ...templates.flatMap(t => t.create('').checks.map(c => `${c.name}|${c.expectedOutput}`))]);
export const isStarterCheck = (check: Check) => check.origin === 'template' || (check.origin === undefined && LEGACY.has(`${check.name}|${check.expectedOutput}`));
