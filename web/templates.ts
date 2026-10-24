import type { Project } from './types';

/** Starting points for new projects. Each is a working program with at least one passing test. */
export type Template = { id: string; name: string; description: string; icon: string; create: (name: string) => Project };

const project = (name: string, files: Project['files'], extra: Partial<Project> = {}): Project =>
  ({ version: 1, name, example: '', mainClass: 'Main', stdin: '', maxSteps: 500, checks: [], files, ...extra });

export const templates: Template[] = [
  {
    id: 'blank', name: 'Blank program', icon: 'file-code-2', description: 'One Main class that prints a line.',
    create: name => project(name, [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, TraceLab!");
    }
}
` }], { checks: [{ name: 'Prints a greeting', stdin: '', expectedOutput: 'Hello, TraceLab!' }] }),
  },
  {
    id: 'input', name: 'Reads input', icon: 'keyboard', description: 'Reads numbers with Scanner. Tests supply the input.',
    create: name => project(name, [{ name: 'Main.java', content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        int a = input.nextInt();
        int b = input.nextInt();
        System.out.println(a + b);
    }
}
` }], { stdin: '2 3', checks: [
      { name: 'Adds two numbers', stdin: '2 3', expectedOutput: '5' },
      { name: 'Negative numbers', stdin: '-4 1', expectedOutput: '-3' },
    ] }),
  },
  {
    id: 'classes', name: 'Class + Main', icon: 'boxes', description: 'A Counter class used from Main, with a method test.',
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
    ], { checks: [
      { name: 'Counts two increments', stdin: '', expectedOutput: '2' },
      { name: 'twice(21)', stdin: '', expectedOutput: '42', kind: 'call', target: 'Counter', call: 'twice(21)' },
    ] }),
  },
  {
    id: 'packages', name: 'Packages', icon: 'package', description: 'An app.Main class and an app.model.Book record in packages.',
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
    ], { mainClass: 'app.Main', checks: [
      { name: 'Describes the book', stdin: '', expectedOutput: 'Dune has 412 pages' },
      { name: 'A long book', stdin: '', expectedOutput: 'true', kind: 'call', target: 'app.model.Book', call: 'new Book("Dune", 412).isLong()' },
    ] }),
  },
];
