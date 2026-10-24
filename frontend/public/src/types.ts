// Shared types for CodeTutor.

/** Programming languages CodeTutor supports. */
export type Language = "java" | "python" | "c";

/** Maps a CodeTutor language to the Monaco editor language id. */
export const MONACO_LANGUAGE_ID: Record<Language, string> = {
  java: "java",
  python: "python",
  c: "c",
};

/** Human-readable labels for the language selector. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  java: "Java",
  python: "Python",
  c: "C",
};

/** Starter snippets shown when the user switches language. */
export const STARTER_CODE: Record<Language, string> = {
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, CodeTutor!");
    }
}
`,
  python: `def main():
    print("Hello, CodeTutor!")


if __name__ == "__main__":
    main()
`,
  c: `#include <stdio.h>

int main(void) {
    printf("Hello, CodeTutor!\\n");
    return 0;
}
`,
};
