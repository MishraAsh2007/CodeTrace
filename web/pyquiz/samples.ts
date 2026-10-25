export interface Sample {
  label: string;
  breakpoints: number[];
  code: string;
}

export const SAMPLES: Record<string, Sample> = {
  linked_list: {
    label: "Linked list: sum of pairs (bug)",
    breakpoints: [20],
    code: `class Node:
    def __init__(self, val):
        self.val = val
        self.next = None


def build_list(values):
    head = Node(values[0])
    current = head
    for v in values[1:]:
        current.next = Node(v)
        current = current.next
    return head


def sum_of_pairs(head):
    total = 0
    current = head
    while current is not None:
        total += current.val + current.next.val
        current = current.next
    return total


head = build_list([1, 2, 3])
print("sum:", sum_of_pairs(head))
`,
  },
  bst: {
    label: "Binary search tree: insert (bug)",
    breakpoints: [22],
    code: `class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None


def insert(root, val):
    if root is None:
        return TreeNode(val)
    if val < root.val:
        insert(root.left, val)
    else:
        root.right = insert(root.right, val)
    return root


root = None
for v in [8, 3, 10, 1, 6, 14]:
    root = insert(root, v)

print("smallest:", root.left.left.val)
`,
  },
  reverse: {
    label: "Linked list: reverse",
    breakpoints: [12],
    code: `class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next


def reverse(head):
    prev = None
    current = head
    while current is not None:
        nxt = current.next
        current.next = prev
        prev = current
        current = nxt
    return prev


head = Node(1, Node(2, Node(3, Node(4))))
head = reverse(head)
print([head.val, head.next.val, head.next.next.val])
`,
  },
  recursion: {
    label: "Recursion: factorial",
    breakpoints: [3],
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print(factorial(4))
`,
  },
};

export const DEFAULT_SAMPLE = "linked_list";
