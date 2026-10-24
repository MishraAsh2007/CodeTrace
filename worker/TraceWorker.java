import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import javax.tools.*;
import java.io.*;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** A dependency-free Java 21 JDI adapter. Stdout is exclusively NDJSON. */
public final class TraceWorker {
    // Capture budgets. Keep these in sync with README.md and docs/PROTOCOL.md.
    static final int MAX_FRAMES = 48, MAX_LOCALS = 32, MAX_OBJECTS = 160, MAX_DEPTH = 48;
    static final int MAX_ELEMENTS = 64, MAX_FIELDS = 24, MAX_STATICS = 32, MAX_RETURNS = 64, MAX_TEXT = 512;

    private final Path workspace;
    private final String mainClass;
    private final int maxSteps;
    private final long timeoutMs;
    private final Set<String> sources = new HashSet<>();
    private final Set<ReferenceType> userTypes = new LinkedHashSet<>();
    private final Map<Long, List<Activation>> activations = new HashMap<>();
    /** Activation-stack size at the first caught exception since the last snapshot. Frames popped by an exception produce no MethodExitEvent. */
    private final Map<Long, Integer> unwindMarks = new HashMap<>();
    private final Map<Long, List<PendingReturn>> returns = new HashMap<>();
    private long nextActivation = 0;
    private long userThread = -1;
    private Process target;
    private VirtualMachine vm;
    private int steps = 0;
    private String stopReason = "completed";
    private final AtomicInteger outputChars = new AtomicInteger();
    private volatile boolean outputTruncated;

    record Activation(String method, String id) {}
    record PendingReturn(String frameId, String method, Value value, boolean isVoid) {}

    /** trace: record with JDI. run: plain JVM, no recording (fast, for tests). compile: javac only. */
    private final String mode;

    /**
     * Optional start point (start.txt in the job directory): nothing is recorded until `line` of `file` is about to
     * run with `condition` true for the `hit`-th time. Until then only the trigger line has a breakpoint, so the
     * program runs at nearly full speed.
     */
    record StartAt(String file, int line, int hit, String text, Condition condition) {}
    private StartAt startAt;
    private boolean recording = true;
    private final List<EventRequest> deferred = new ArrayList<>();
    private final List<BreakpointRequest> triggers = new ArrayList<>();
    private boolean startFileLoaded, startLineFound;
    private int triggerVisits, conditionTrue, startedLine = -1;
    private String startProblem;

    private TraceWorker(String[] args) {
        workspace = Path.of(args[0]).toAbsolutePath();
        mainClass = args[1];
        maxSteps = Integer.parseInt(args[2]);
        timeoutMs = Long.parseLong(args[3]);
        mode = args.length > 4 ? args[4] : "trace";
    }

    public static void main(String[] args) {
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        TraceWorker worker = new TraceWorker(args);
        Runtime.getRuntime().addShutdownHook(new Thread(worker::stopTarget));
        try { worker.run(); }
        catch (Throwable failure) {
            worker.stopTarget();
            emit(map("kind", "terminated", "stopReason", "worker-error", "message", failure.getClass().getSimpleName() + ": " + failure.getMessage()));
        }
    }

    private void run() throws Exception {
        Path startFile = workspace.resolve("start.txt");
        if (mode.equals("trace") && Files.exists(startFile)) {
            List<String> parts = Files.readAllLines(startFile, StandardCharsets.UTF_8);
            String text = parts.size() > 3 ? parts.get(3).trim() : "";
            try {
                startAt = new StartAt(parts.get(0), Integer.parseInt(parts.get(1)), Integer.parseInt(parts.get(2)), text, text.isEmpty() ? null : Condition.parse(text));
                recording = false;
            } catch (IllegalArgumentException bad) {
                emit(map("kind", "terminated", "stopReason", "bad-start", "message", "The start condition “" + text + "” can’t be read: " + bad.getMessage()));
                return;
            }
        }
        emit(map("kind", "status", "message", "Compiling Java 21 with debug information…"));
        if (!compile()) {
            emit(map("kind", "terminated", "stopReason", "compile-error", "message", "Fix the compiler diagnostics, then run again."));
            return;
        }
        if (mode.equals("compile")) { emit(map("kind", "terminated", "stopReason", "compiled", "message", "The program compiles.")); return; }
        if (cancelled()) { finish("cancelled"); return; }
        if (mode.equals("run")) { runPlain(); return; }
        LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> args = connector.defaultArguments();
        args.get("main").setValue(mainClass);
        args.get("options").setValue("-Xmx96m -Xss512k -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -cp \"" + workspace.resolve("classes") + "\"");
        args.get("suspend").setValue("true");
        vm = connector.launch(args);
        target = vm.process();
        Thread stdout = pump(target.getInputStream(), "stdout");
        Thread stderr = pump(target.getErrorStream(), "stderr");
        Thread input = new Thread(() -> {
            try (OutputStream stream = target.getOutputStream()) {
                stream.write(Files.readAllBytes(workspace.resolve("stdin.txt")));
                stream.flush();
            } catch (IOException ignored) { }
        }, "student-stdin");
        input.setDaemon(true);
        input.start();
        ClassPrepareRequest prepare = vm.eventRequestManager().createClassPrepareRequest();
        prepare.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        prepare.enable();
        ExceptionRequest exceptions = vm.eventRequestManager().createExceptionRequest(null, true, true);
        exceptions.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        exceptions.enable();
        long start = System.nanoTime();
        boolean done = false, vmDied = false;
        try {
            while (!done) {
                if (cancelled()) { stopReason = "cancelled"; break; }
                if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) >= timeoutMs) { stopReason = "timeout"; break; }
                EventSet events = vm.eventQueue().remove(60);
                if (events == null) continue;
                for (Event event : events) {
                    if (event instanceof ClassPrepareEvent e) prepareClass(e.referenceType());
                    else if (event instanceof MethodEntryEvent e) {
                        activations.computeIfAbsent(e.thread().uniqueID(), key -> new ArrayList<>())
                            .add(new Activation(methodKey(e.method()), "f" + (++nextActivation)));
                    } else if (event instanceof MethodExitEvent e) {
                        recordReturn(e, popActivation(e.thread().uniqueID(), methodKey(e.method())));
                    } else if (event instanceof BreakpointEvent e) {
                        if (!recording) {
                            if (!triggers.contains(e.request()) || !startConditionHolds(e.thread())) continue;
                            if (++conditionTrue < startAt.hit()) continue;
                            startRecording(e.thread());
                            startedLine = e.location().lineNumber();
                        }
                        if (userThread == -1) userThread = e.thread().uniqueID();
                        if (userThread != e.thread().uniqueID()) { stopReason = "unsupported-concurrency"; done = true; break; }
                        snapshot(e.thread(), e.location(), null);
                        if (++steps >= maxSteps) { stopReason = "step-limit"; done = true; break; }
                    } else if (event instanceof ExceptionEvent e) {
                        Location sourceLocation = userLocation(e.thread());
                        boolean caught = e.catchLocation() != null;
                        if (!recording) {
                            // An uncaught exception before the start point ends the program: record that moment.
                            if (caught || sourceLocation == null) continue;
                            startRecording(e.thread());
                        }
                        // Exceptions thrown and handled entirely inside library code are implementation noise.
                        boolean relevant = sourceLocation != null && (!caught || isUser(e.location().declaringType()) || isUser(e.catchLocation().declaringType()));
                        if (relevant) {
                            snapshot(e.thread(), sourceLocation, e);
                            if (!caught) stopReason = "exception";
                        }
                        if (caught) {
                            List<Activation> stack = activations.get(e.thread().uniqueID());
                            if (stack != null) unwindMarks.putIfAbsent(e.thread().uniqueID(), stack.size());
                        }
                        if (relevant && ++steps >= maxSteps) { stopReason = "step-limit"; done = true; break; }
                    } else if (event instanceof VMDeathEvent) { vmDied = true; done = true; break; }
                    else if (event instanceof VMDisconnectEvent) done = true;
                }
                if (!vmDied) events.resume();
            }
        } catch (VMDisconnectedException ignored) { }
        finally {
            // A finished target otherwise waits about two seconds for the debugger connection to close.
            if (vmDied) { try { vm.dispose(); } catch (RuntimeException ignored) { } }
            if (stopReason.equals("completed") || stopReason.equals("exception")) target.waitFor(2000, TimeUnit.MILLISECONDS);
            stopTarget();
        }
        stdout.join(700);
        stderr.join(700);
        int exitCode = target.isAlive() ? -1 : target.exitValue();
        if (stopReason.equals("completed") && exitCode != 0) stopReason = "runtime-error";
        Map<String, Object> end = map("kind", "terminated", "stopReason", stopReason, "steps", steps, "exitCode", exitCode,
            "outputTruncated", outputTruncated, "message", stopMessage(stopReason));
        if (startAt != null) {
            Map<String, Object> point = map("reached", startedLine >= 0, "file", startAt.file(), "line", startedLine >= 0 ? startedLine : startAt.line());
            if (startedLine < 0) {
                point.put("message", startMissed());
                if (steps == 0) end.put("message", "Nothing was recorded. " + startMissed());
            }
            end.put("start", point);
        }
        emit(end);
    }

    /** Why the recording never started, in the user's terms. */
    private String startMissed() {
        String where = "line " + startAt.line() + " of " + startAt.file();
        String condition = startAt.condition() == null ? "" : " with " + startAt.text() + " true";
        if (!startFileLoaded) return "The program never used " + startAt.file() + ", so " + where + " never ran.";
        if (!startLineFound) return "There is no code that runs on " + where + ". Choose a line with a statement inside a method.";
        if (triggerVisits == 0) return "The program never reached " + where + ".";
        String problem = startProblem == null ? "" : " " + startProblem;
        if (startAt.condition() == null || conditionTrue > 0) {
            return "The program reached " + where + condition + " " + times(conditionTrue) + ", fewer than the " + startAt.hit() + " needed." + problem;
        }
        return "The program reached " + where + " " + times(triggerVisits) + ", but " + startAt.text() + " was never true." + problem;
    }
    private static String times(int n) { return n == 1 ? "once" : n == 2 ? "twice" : n + " times"; }

    /** Turns on full recording: every line breakpoint and method event, with activations for the frames already running. */
    private void startRecording(ThreadReference thread) throws IncompatibleThreadStateException {
        recording = true;
        vm.eventRequestManager().deleteEventRequests(triggers);
        triggers.clear();
        for (EventRequest request : deferred) request.enable();
        deferred.clear();
        List<Activation> stack = activations.computeIfAbsent(thread.uniqueID(), key -> new ArrayList<>());
        stack.clear();
        List<StackFrame> frames = thread.frames();
        for (int i = frames.size() - 1; i >= 0; i--) {
            Location location = frames.get(i).location();
            if (isUser(location.declaringType())) stack.add(new Activation(methodKey(location.method()), "f" + (++nextActivation)));
        }
    }

    private boolean startConditionHolds(ThreadReference thread) {
        triggerVisits++;
        if (startAt.condition() == null) return true;
        try { return startAt.condition().test(new Scope(thread.frame(0))); }
        catch (Condition.Failure failure) {
            if (startProblem == null) startProblem = failure.getMessage();
            return false;
        } catch (IncompatibleThreadStateException | RuntimeException unavailable) {
            if (startProblem == null) startProblem = "The values on that line couldn’t be read.";
            return false;
        }
    }

    /** Names in a start condition: locals of the paused frame, then fields of `this`, then static fields of user classes. */
    private final class Scope {
        final StackFrame frame;
        Scope(StackFrame frame) { this.frame = frame; }

        Object name(String name) throws Condition.Failure {
            try {
                LocalVariable variable = frame.visibleVariableByName(name);
                if (variable != null) return Condition.plain(frame.getValue(variable));
            } catch (AbsentInformationException ignored) { }
            ObjectReference self = frame.thisObject();
            if (self != null) {
                Field field = self.referenceType().fieldByName(name);
                if (field != null && !field.isStatic()) return Condition.plain(self.getValue(field));
            }
            ReferenceType here = frame.location().declaringType();
            Field own = here.fieldByName(name);
            if (own != null && own.isStatic()) return Condition.plain(here.getValue(own));
            for (ReferenceType type : userTypes) if (type.name().replaceAll(".*[.$]", "").equals(name)) return type;
            throw new Condition.Failure("`" + name + "` isn’t a variable or field on that line.");
        }

        Object member(Object target, String name, boolean call) throws Condition.Failure {
            if (target instanceof ReferenceType type) {
                Field field = type.fieldByName(name);
                if (field == null || !field.isStatic()) throw new Condition.Failure("`" + type.name() + "` has no static field `" + name + "`.");
                return Condition.plain(type.getValue(field));
            }
            if (target == null) throw new Condition.Failure("`." + name + "` was used on null.");
            if (target instanceof String text) {
                if (name.equals("length") && call) return (long) text.length();
                if (name.equals("isEmpty") && call) return text.isEmpty();
                throw new Condition.Failure("Strings support only .length() and .isEmpty() here.");
            }
            if (target instanceof ArrayReference array) {
                if (name.equals("length") && !call) return (long) array.length();
                throw new Condition.Failure("Arrays support only .length here.");
            }
            if (!(target instanceof ObjectReference object)) throw new Condition.Failure("`." + name + "` needs an object.");
            if (call) {
                if (!name.equals("size") && !name.equals("isEmpty")) throw new Condition.Failure("Only .size() and .isEmpty() can be called, because recording never runs your methods.");
                String type = object.referenceType().name();
                Map<String, Object> view = new HeapCapture().library(object, type, MAX_DEPTH);
                if (view == null || !(view.get("length") instanceof Integer size)) throw new Condition.Failure("TraceLab can’t read the size of a " + type.replaceAll(".*\\.", "") + ".");
                return name.equals("size") ? (Object) (long) size : (Object) (size == 0);
            }
            Field field = object.referenceType().fieldByName(name);
            if (field == null || field.isStatic()) throw new Condition.Failure("`" + object.referenceType().name().replaceAll(".*[.$]", "") + "` has no field `" + name + "`.");
            return Condition.plain(object.getValue(field));
        }

        Object index(Object target, Object index) throws Condition.Failure {
            if (!(target instanceof ArrayReference array)) throw new Condition.Failure("Only arrays can be indexed here.");
            if (!(index instanceof Long i)) throw new Condition.Failure("An array index must be a whole number.");
            if (i < 0 || i >= array.length()) throw new Condition.Failure("Index " + i + " is outside the array (length " + array.length() + ").");
            return Condition.plain(array.getValue(i.intValue()));
        }
    }

    /**
     * A small condition language for start points: variables, fields, array elements, `.length`, `.size()` and
     * `.isEmpty()`, numbers, chars, strings, true/false/null, + - * / %, comparisons, !, && and ||. Strings
     * compare by text. Evaluation reads values only; it never runs target code.
     */
    static final class Condition {
        static final class Failure extends Exception { Failure(String message) { super(message, null, false, false); } }
        interface Node { Object eval(Scope scope) throws Failure; }
        private final Node root;
        private Condition(Node root) { this.root = root; }

        boolean test(Scope scope) throws Failure {
            if (root.eval(scope) instanceof Boolean b) return b;
            throw new Failure("The condition must be true or false, such as i == 5.");
        }

        /** Mirrors a JDI value as Long (integers and chars), Double, Boolean, String, null, or an object reference. */
        static Object plain(Value value) {
            if (value == null) return null;
            if (value instanceof BooleanValue b) return b.value();
            if (value instanceof CharValue c) return (long) c.value();
            if (value instanceof FloatValue || value instanceof DoubleValue) return ((PrimitiveValue) value).doubleValue();
            if (value instanceof PrimitiveValue p) return p.longValue();
            if (value instanceof StringReference s) return s.value();
            if (value instanceof ObjectReference o && o.referenceType().name().matches("java\\.lang\\.(Integer|Long|Short|Byte|Double|Float|Boolean|Character)")) {
                Field inner = o.referenceType().fieldByName("value");
                return inner == null ? o : plain(o.getValue(inner));
            }
            return value;
        }

        private final List<String> tokens = new ArrayList<>();
        private int at;

        static Condition parse(String text) {
            Condition c = new Condition(null);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\s*(\\d+(?:\\.\\d+)?[lLdDfF]?|[A-Za-z_$][\\w$]*|\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)'|==|!=|<=|>=|&&|\\|\\||[-+*/%<>!().\\[\\]])").matcher(text);
            int position = 0;
            while (position < text.length()) {
                if (!m.find(position) || m.start() != position) {
                    if (text.substring(position).isBlank()) break;
                    throw new IllegalArgumentException("unexpected “" + text.substring(position).trim().charAt(0) + "”.");
                }
                c.tokens.add(m.group(1));
                position = m.end();
            }
            if (c.tokens.isEmpty()) throw new IllegalArgumentException("it is empty.");
            Node root = c.or();
            if (c.at < c.tokens.size()) throw new IllegalArgumentException("unexpected “" + c.tokens.get(c.at) + "”.");
            return new Condition(root);
        }
        private String peek() { return at < tokens.size() ? tokens.get(at) : ""; }
        private boolean accept(String token) { if (peek().equals(token)) { at++; return true; } return false; }
        private void expect(String token) { if (!accept(token)) throw new IllegalArgumentException("expected “" + token + "”" + (peek().isEmpty() ? " at the end." : " before “" + peek() + "”.")); }

        private Node or() {
            Node left = and();
            while (accept("||")) { Node a = left, b = and(); left = s -> bool(a.eval(s), "||") || bool(b.eval(s), "||"); }
            return left;
        }
        private Node and() {
            Node left = not();
            while (accept("&&")) { Node a = left, b = not(); left = s -> bool(a.eval(s), "&&") && bool(b.eval(s), "&&"); }
            return left;
        }
        private Node not() {
            if (accept("!")) { Node inner = not(); return s -> !bool(inner.eval(s), "!"); }
            return comparison();
        }
        private Node comparison() {
            Node left = sum();
            String op = peek();
            if (!List.of("==", "!=", "<", "<=", ">", ">=").contains(op)) return left;
            at++;
            Node a = left, b = sum();
            return s -> compare(op, a.eval(s), b.eval(s));
        }
        private Node sum() {
            Node left = product();
            while (peek().equals("+") || peek().equals("-")) { String op = tokens.get(at++); Node a = left, b = product(); left = s -> arithmetic(op, a.eval(s), b.eval(s)); }
            return left;
        }
        private Node product() {
            Node left = unary();
            while (peek().equals("*") || peek().equals("/") || peek().equals("%")) { String op = tokens.get(at++); Node a = left, b = unary(); left = s -> arithmetic(op, a.eval(s), b.eval(s)); }
            return left;
        }
        private Node unary() {
            if (accept("-")) { Node inner = unary(); return s -> arithmetic("-", 0L, inner.eval(s)); }
            return postfix();
        }
        private Node postfix() {
            Node node = primary();
            for (;;) {
                if (accept(".")) {
                    String name = peek();
                    if (!name.matches("[A-Za-z_$][\\w$]*")) throw new IllegalArgumentException("expected a name after “.”.");
                    at++;
                    boolean call = accept("(");
                    if (call && !List.of("size", "isEmpty", "length").contains(name)) throw new IllegalArgumentException("only .size(), .isEmpty() and .length() can be called, because recording never runs your methods.");
                    if (call) expect(")");
                    Node target = node;
                    node = s -> s.member(target.eval(s), name, call);
                } else if (accept("[")) {
                    Node target = node, index = or();
                    expect("]");
                    node = s -> s.index(target.eval(s), index.eval(s));
                } else return node;
            }
        }
        private Node primary() {
            String t = peek();
            if (t.isEmpty()) throw new IllegalArgumentException("it ends too early.");
            at++;
            if (t.equals("(")) { Node inner = or(); expect(")"); return inner; }
            if (t.equals("true") || t.equals("false")) { boolean b = t.equals("true"); return s -> b; }
            if (t.equals("null")) return s -> null;
            if (Character.isDigit(t.charAt(0))) {
                String digits = t.replaceAll("[lLdDfF]$", "");
                Object number = digits.contains(".") || t.matches(".*[dDfF]$") ? (Object) Double.parseDouble(digits) : (Object) Long.parseLong(digits);
                return s -> number;
            }
            if (t.startsWith("\"")) { String text = unescape(t.substring(1, t.length() - 1)); return s -> text; }
            if (t.startsWith("'")) { long c = unescape(t.substring(1, t.length() - 1)).charAt(0); return s -> c; }
            if (t.matches("[A-Za-z_$][\\w$]*")) return s -> s.name(t);
            throw new IllegalArgumentException("unexpected “" + t + "”.");
        }
        private static String unescape(String text) {
            return text.replace("\\n", "\n").replace("\\t", "\t").replace("\\'", "'").replace("\\\"", "\"").replace("\\\\", "\\");
        }

        private static boolean bool(Object value, String op) throws Failure {
            if (value instanceof Boolean b) return b;
            throw new Failure("`" + op + "` needs true or false on both sides.");
        }
        private static Object arithmetic(String op, Object a, Object b) throws Failure {
            if (!(a instanceof Number x) || !(b instanceof Number y)) throw new Failure("`" + op + "` needs numbers.");
            if (x instanceof Long i && y instanceof Long j) {
                if ((op.equals("/") || op.equals("%")) && j == 0) throw new Failure("The condition divides by zero.");
                return switch (op) { case "+" -> i + j; case "-" -> i - j; case "*" -> i * j; case "/" -> i / j; default -> i % j; };
            }
            double i = x.doubleValue(), j = y.doubleValue();
            return switch (op) { case "+" -> i + j; case "-" -> i - j; case "*" -> i * j; case "/" -> i / j; default -> i % j; };
        }
        private static Object compare(String op, Object a, Object b) throws Failure {
            if (a instanceof Number x && b instanceof Number y) {
                int c = x instanceof Long i && y instanceof Long j ? Long.compare(i, j) : Double.compare(x.doubleValue(), y.doubleValue());
                return switch (op) { case "==" -> c == 0; case "!=" -> c != 0; case "<" -> c < 0; case "<=" -> c <= 0; case ">" -> c > 0; default -> c >= 0; };
            }
            if (!op.equals("==") && !op.equals("!=")) throw new Failure("`" + op + "` compares numbers only.");
            boolean same;
            if (a == null || b == null) same = a == b;
            else if (a instanceof String || b instanceof String || a instanceof Boolean || b instanceof Boolean) {
                if (a.getClass() != b.getClass()) throw new Failure("`" + op + "` can’t compare these two kinds of value.");
                same = a.equals(b);
            } else same = a.equals(b);
            return op.equals("==") == same;
        }
    }

    /**
     * Runs the program without a debugger. Output is captured the same way as in a traced run; an uncaught
     * exception is reported from the JVM's own "Exception in thread" line, since no exception events exist.
     */
    private void runPlain() throws Exception {
        Path launcher = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java");
        ProcessBuilder builder = new ProcessBuilder(launcher.toString(), "-Xmx96m", "-Xss512k", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8",
            "-cp", workspace.resolve("classes").toString(), mainClass).directory(workspace.toFile());
        for (String key : List.of("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH")) builder.environment().remove(key);
        target = builder.start();
        StringBuilder errors = new StringBuilder();
        Thread stdout = pump(target.getInputStream(), "stdout", null);
        Thread stderr = pump(target.getErrorStream(), "stderr", errors);
        // Written on its own thread: a program that never reads stdin must not block the worker.
        Process process = target;
        Thread input = new Thread(() -> {
            try (OutputStream stream = process.getOutputStream()) { stream.write(Files.readAllBytes(workspace.resolve("stdin.txt"))); }
            catch (IOException ignored) { }
        }, "student-stdin");
        input.setDaemon(true);
        input.start();
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (target.isAlive() && System.nanoTime() < deadline && !cancelled() && !outputTruncated) target.waitFor(50, TimeUnit.MILLISECONDS);
        // A program that has filled the output budget is almost always looping; stop it instead of waiting.
        String reason = !target.isAlive() ? "completed" : cancelled() ? "cancelled" : outputTruncated ? "output-limit" : "timeout";
        stopTarget();
        stdout.join(700);
        stderr.join(700);
        int exitCode = target.isAlive() ? -1 : target.exitValue();
        Map<String, Object> end = map("kind", "terminated", "stopReason", reason, "steps", 0, "exitCode", exitCode, "outputTruncated", outputTruncated, "recorded", false);
        if (reason.equals("completed") && exitCode != 0) {
            java.util.regex.Matcher thrown = java.util.regex.Pattern.compile("Exception in thread \"[^\"]*\" ([\\w$.]+)(?::\\s?(.*))?").matcher(errors);
            if (thrown.find()) {
                reason = "exception";
                end.put("exception", map("type", thrown.group(1), "message", clip(thrown.group(2) == null ? "" : thrown.group(2).trim(), 1000), "caught", false));
            } else reason = "runtime-error";
            end.put("stopReason", reason);
        }
        end.put("message", stopMessage(reason));
        emit(end);
    }

    private boolean compile() throws Exception {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("A full JDK is required.");
        Path sourceRoot = workspace.resolve("src");
        List<Path> files;
        try (var paths = Files.walk(sourceRoot)) {
            files = paths.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
        for (Path file : files) sources.add(sourceRoot.relativize(file).toString().replace('\\', '/'));
        Path classes = workspace.resolve("classes");
        Files.createDirectories(classes);
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager manager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            boolean success = compiler.getTask(new StringWriter(), manager, diagnostics,
                List.of("-g", "-proc:none", "--release", "21", "-encoding", "UTF-8", "-d", classes.toString()), null,
                manager.getJavaFileObjectsFromPaths(files)).call();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                String file = d.getSource() == null ? "" : sourceRoot.relativize(Path.of(d.getSource().toUri())).toString().replace('\\', '/');
                emit(map("kind", "diagnostic", "severity", d.getKind().name().toLowerCase(Locale.ROOT), "file", file,
                    "line", d.getLineNumber(), "column", d.getColumnNumber(), "message", d.getMessage(Locale.ROOT)));
            }
            return success;
        }
    }

    private void prepareClass(ReferenceType type) {
        if (!isUser(type)) return;
        userTypes.add(type);
        EventRequestManager manager = vm.eventRequestManager();
        MethodEntryRequest enter = manager.createMethodEntryRequest();
        enter.addClassFilter(type); enter.setSuspendPolicy(EventRequest.SUSPEND_ALL); activate(enter);
        MethodExitRequest exit = manager.createMethodExitRequest();
        exit.addClassFilter(type); exit.setSuspendPolicy(EventRequest.SUSPEND_ALL); activate(exit);
        try {
            Set<String> seen = new HashSet<>();
            for (Location location : type.allLineLocations()) {
                String key = methodKey(location.method()) + ":" + location.codeIndex();
                if (!seen.add(key)) continue;
                BreakpointRequest bp = manager.createBreakpointRequest(location);
                bp.setSuspendPolicy(EventRequest.SUSPEND_ALL); activate(bp);
            }
            if (!recording && type.sourcePaths(null).stream().anyMatch(p -> p.replace('\\', '/').equals(startAt.file()))) addTriggers(type);
        } catch (AbsentInformationException ignored) { }
    }

    /** Requests made before the start point stay off until recording starts. */
    private void activate(EventRequest request) { if (recording) request.enable(); else deferred.add(request); }

    /**
     * Breakpoints for the start line in this class. A line without code (a blank line, a comment, a closing brace)
     * moves to the next line with code in the same method.
     */
    private void addTriggers(ReferenceType type) throws AbsentInformationException {
        startFileLoaded = true;
        int line = startAt.line();
        for (Method method : type.methods()) {
            List<Location> lines;
            try { lines = method.allLineLocations(); } catch (AbsentInformationException none) { continue; }
            if (lines.isEmpty()) continue;
            int first = Integer.MAX_VALUE, last = -1, next = Integer.MAX_VALUE;
            for (Location l : lines) {
                first = Math.min(first, l.lineNumber()); last = Math.max(last, l.lineNumber());
                if (l.lineNumber() >= line) next = Math.min(next, l.lineNumber());
            }
            if (line < first - 1 || line > last || next == Integer.MAX_VALUE) continue;
            // One line before the first is the method's signature: start at its first statement.
            Set<Long> seen = new HashSet<>();
            for (Location l : lines) {
                if (l.lineNumber() != next || !seen.add(l.codeIndex())) continue;
                BreakpointRequest trigger = vm.eventRequestManager().createBreakpointRequest(l);
                trigger.setSuspendPolicy(EventRequest.SUSPEND_ALL); trigger.enable();
                triggers.add(trigger);
                startLineFound = true;
            }
        }
    }

    private boolean isUser(ReferenceType type) {
        try {
            for (String source : type.sourcePaths(null)) if (sources.contains(source.replace('\\', '/'))) return true;
        } catch (AbsentInformationException ignored) { }
        return false;
    }

    private String sourcePath(Location location) {
        try { return location.sourcePath().replace('\\', '/'); }
        catch (AbsentInformationException ignored) { return ""; }
    }

    private Location userLocation(ThreadReference thread) throws IncompatibleThreadStateException {
        for (StackFrame frame : thread.frames()) if (isUser(frame.location().declaringType())) return frame.location();
        return null;
    }

    private static String methodKey(Method method) { return method.declaringType().name() + "." + method.name() + method.signature(); }

    /** Pops the newest activation of the exiting method. Entries above it were left behind by exceptional exits. */
    private Activation popActivation(long threadId, String key) {
        List<Activation> stack = activations.get(threadId);
        if (stack == null) return null;
        for (int i = stack.size() - 1; i >= 0; i--) {
            if (!stack.get(i).method().equals(key)) continue;
            Activation activation = stack.get(i);
            stack.subList(i, stack.size()).clear();
            unwindMarks.computeIfPresent(threadId, (id, mark) -> Math.min(mark, stack.size()));
            return activation;
        }
        return null;
    }

    private void recordReturn(MethodExitEvent event, Activation activation) {
        Method method = event.method();
        if (method.isConstructor() || method.isStaticInitializer() || method.isSynthetic() || method.isBridge()) return;
        boolean isVoid = "void".equals(method.returnTypeName());
        Value value = null;
        if (!isVoid) {
            try { value = event.returnValue(); }
            catch (UnsupportedOperationException unsupported) { return; }
            // Keep a returned object alive until the next snapshot can describe it.
            if (value instanceof ObjectReference object) {
                try { object.disableCollection(); } catch (RuntimeException ignored) { }
            }
        }
        List<PendingReturn> pending = returns.computeIfAbsent(event.thread().uniqueID(), key -> new ArrayList<>());
        if (pending.size() >= MAX_RETURNS) release(pending.remove(0));
        pending.add(new PendingReturn(activation == null ? null : activation.id(), method.declaringType().name() + "." + method.name(), value, isVoid));
    }

    private static void release(PendingReturn pending) {
        if (pending.value() instanceof ObjectReference object) {
            try { object.enableCollection(); } catch (RuntimeException ignored) { }
        }
    }

    /** Assigns activation IDs to user frames (top first), repairing the stack after exceptional unwinding. */
    private List<String> frameIds(long threadId, List<StackFrame> userFrames) {
        List<Activation> stack = activations.computeIfAbsent(threadId, key -> new ArrayList<>());
        Integer mark = unwindMarks.remove(threadId);
        if (mark != null && mark <= stack.size()) {
            // Unwinding removes the newest frames that existed when the exception was thrown; later calls sit above the mark.
            List<Activation> newer = new ArrayList<>(stack.subList(mark, stack.size()));
            int keepOld = Math.max(0, Math.min(mark, userFrames.size() - newer.size()));
            List<Activation> rebuilt = new ArrayList<>(stack.subList(0, keepOld));
            rebuilt.addAll(newer);
            stack.clear(); stack.addAll(rebuilt);
        }
        List<String> ids = new ArrayList<>();
        boolean aligned = stack.size() == userFrames.size();
        for (int i = 0; aligned && i < userFrames.size(); i++) {
            aligned = stack.get(stack.size() - 1 - i).method().equals(methodKey(userFrames.get(i).location().method()));
        }
        if (aligned) {
            for (int i = 0; i < userFrames.size(); i++) ids.add(stack.get(stack.size() - 1 - i).id());
            return ids;
        }
        int index = stack.size() - 1;
        for (int i = 0; i < userFrames.size(); i++) {
            String key = methodKey(userFrames.get(i).location().method());
            String id = "depth-" + i;
            while (index >= 0) {
                Activation activation = stack.get(index--);
                if (activation.method().equals(key)) { id = activation.id(); break; }
            }
            ids.add(id);
        }
        return ids;
    }

    private void snapshot(ThreadReference thread, Location location, ExceptionEvent exception) throws Exception {
        HeapCapture capture = new HeapCapture();
        List<StackFrame> userFrames = new ArrayList<>();
        for (StackFrame frame : thread.frames()) if (isUser(frame.location().declaringType())) userFrames.add(frame);
        List<String> ids = frameIds(thread.uniqueID(), userFrames);
        List<Object> frames = new ArrayList<>();
        boolean framesTruncated = userFrames.size() > MAX_FRAMES;
        for (int f = 0; f < Math.min(userFrames.size(), MAX_FRAMES); f++) {
            StackFrame frame = userFrames.get(f);
            List<Object> locals = new ArrayList<>();
            if (frame.thisObject() != null) locals.add(map("name", "this", "type", frame.thisObject().referenceType().name(), "value", capture.value(frame.thisObject(), 0)));
            boolean localsTruncated = false;
            try {
                List<LocalVariable> variables = frame.visibleVariables();
                Map<LocalVariable, Value> values = frame.getValues(variables);
                for (LocalVariable variable : variables) {
                    if (locals.size() >= MAX_LOCALS) { localsTruncated = true; break; }
                    Map<String, Object> local = map("name", variable.name(), "type", variable.typeName(), "value", capture.value(values.get(variable), 0));
                    if (variable.isArgument()) local.put("argument", true);
                    locals.add(local);
                }
            } catch (AbsentInformationException ignored) { }
            frames.add(map("id", ids.get(f), "method", frame.location().declaringType().name() + "." + frame.location().method().name(),
                "file", sourcePath(frame.location()), "line", frame.location().lineNumber(), "locals", locals, "truncated", localsTruncated));
        }
        List<Object> statics = new ArrayList<>();
        for (ReferenceType type : userTypes) {
            if (statics.size() >= MAX_STATICS) break;
            List<Field> fields = type.fields().stream().filter(f -> f.isStatic() && !f.isSynthetic()).limit(MAX_STATICS - statics.size()).toList();
            if (fields.isEmpty()) continue;
            try {
                Map<Field, Value> values = type.getValues(fields);
                for (Field field : fields) statics.add(map("name", type.name() + "." + field.name(), "type", field.typeName(), "value", capture.value(values.get(field), 0)));
            } catch (RuntimeException ignored) { }
        }
        Map<String, Object> event = map("kind", exception == null ? "line" : "exception", "threadId", String.valueOf(thread.uniqueID()),
            "location", map("file", sourcePath(location), "line", location.lineNumber(), "phase", "before"),
            "frames", frames, "statics", statics, "framesTruncated", framesTruncated);
        List<PendingReturn> completed = returns.remove(thread.uniqueID());
        if (completed != null && !completed.isEmpty()) {
            List<Object> list = new ArrayList<>();
            for (PendingReturn item : completed) {
                Map<String, Object> entry = map("method", item.method(), "frameId", item.frameId());
                if (item.isVoid()) entry.put("void", true);
                else entry.put("value", capture.value(item.value(), 0));
                list.add(entry);
            }
            event.put("returns", list);
        }
        if (exception != null) {
            ObjectReference object = exception.exception();
            Field detail = object.referenceType().fieldByName("detailMessage");
            Value detailValue = detail == null ? null : object.getValue(detail);
            String message = detailValue instanceof StringReference text ? text.value() : "";
            event.put("exception", map("type", object.referenceType().name(), "message", clip(message, 1000), "caught", exception.catchLocation() != null));
        }
        capture.drain();
        if (completed != null) completed.forEach(TraceWorker::release);
        event.put("heap", capture.objects);
        event.put("heapTruncated", capture.truncated);
        emit(event);
    }

    /** Breadth-first capture of reachable objects. Never invokes methods on target objects. */
    private final class HeapCapture {
        final List<Object> objects = new ArrayList<>();
        final Set<Long> seen = new HashSet<>();
        final Deque<Pending> pending = new ArrayDeque<>();
        boolean truncated;
        record Pending(ObjectReference object, int depth) {}

        Object value(Value value, int depth) {
            if (value == null) return map("kind", "null", "value", "null");
            if (value instanceof ObjectReference object) {
                String id = "o" + object.uniqueID();
                if (!seen.contains(object.uniqueID())) {
                    if (seen.size() >= MAX_OBJECTS || depth > MAX_DEPTH) {
                        truncated = true;
                        return map("kind", "reference", "ref", id, "type", object.referenceType().name(), "omitted", true);
                    }
                    seen.add(object.uniqueID()); pending.add(new Pending(object, depth));
                }
                return map("kind", "reference", "ref", id, "type", object.referenceType().name());
            }
            return map("kind", "primitive", "type", value.type().name(), "value", value.toString());
        }

        List<Object> values(List<? extends Value> values, int depth) {
            List<Object> out = new ArrayList<>();
            for (Value value : values) out.add(value(value, depth));
            return out;
        }

        void drain() {
            while (!pending.isEmpty()) {
                Pending item = pending.remove();
                ObjectReference object = item.object();
                String type = object.referenceType().name();
                int depth = item.depth() + 1;
                Map<String, Object> node = map("id", "o" + object.uniqueID(), "type", type);
                try {
                    if (object instanceof StringReference string) {
                        node.put("kind", "string"); node.put("text", clip(string.value(), MAX_TEXT));
                        node.put("truncated", string.value().length() > MAX_TEXT);
                    } else if (object instanceof ArrayReference array) {
                        node.put("kind", "array"); node.put("length", array.length());
                        List<Value> items = array.getValues(0, Math.min(array.length(), MAX_ELEMENTS));
                        String component = type.substring(0, type.length() - 2);
                        if (PRIMITIVES.contains(component)) {
                            // Compact form for primitive arrays: one type and the values as text (see PROTOCOL.md).
                            List<String> texts = new ArrayList<>(items.size());
                            for (Value v : items) texts.add(v.toString());
                            node.put("elementType", component); node.put("values", texts);
                        } else node.put("elements", values(items, depth));
                        node.put("truncated", array.length() > MAX_ELEMENTS);
                    } else if (boxed.containsKey(object.uniqueID())) {
                        node.putAll(boxed.get(object.uniqueID()));
                    } else {
                        Map<String, Object> library = library(object, type, depth);
                        if (library != null) node.putAll(library);
                        else if (isLibraryType(type) && !type.matches("java\\.lang\\.(Integer|Long|Short|Byte|Double|Float|Boolean|Character)")) {
                            node.put("kind", "opaque");
                            node.put("message", "Library internals are hidden. Strings, arrays, boxed values, collections, iterators, Optional, BitSet, BigInteger and java.time values have dedicated views.");
                        } else {
                            node.put("kind", "object");
                            List<Object> fields = new ArrayList<>();
                            List<Field> all = object.referenceType().allFields().stream().filter(f -> !f.isStatic() && !f.isSynthetic()).toList();
                            List<Field> shown = all.stream().limit(MAX_FIELDS).toList();
                            Map<Field, Value> values = object.getValues(shown);
                            for (Field field : shown) {
                                fields.add(map("name", field.declaringType().name() + "." + field.name(), "type", field.typeName(), "value", value(values.get(field), depth)));
                            }
                            node.put("fields", fields); node.put("truncated", all.size() > MAX_FIELDS);
                            // Boxed values never change, so later steps reuse what was read.
                            if (BOXED.contains(type)) boxed.put(object.uniqueID(), map("kind", "object", "fields", fields, "truncated", false));
                        }
                    }
                } catch (RuntimeException unavailable) {
                    node.clear(); node.put("id", "o" + object.uniqueID()); node.put("type", type);
                    node.put("kind", "unavailable"); node.put("message", "Object contents unavailable.");
                }
                objects.add(node);
            }
        }

        /** Logical views of selected JDK collections, read from their fields. Returns null if the layout is unrecognized. */
        Map<String, Object> library(ObjectReference object, String type, int depth) {
            try {
                return switch (type) {
                    case "java.util.ArrayList" -> {
                        int size = intField(object, "size");
                        ArrayReference data = (ArrayReference) field(object, "elementData");
                        yield sequence("list", size, data == null ? List.of() : data.getValues(0, Math.min(size, Math.min(MAX_ELEMENTS, data.length()))), depth, null);
                    }
                    case "java.util.Arrays$ArrayList" -> {
                        ArrayReference data = (ArrayReference) field(object, "a");
                        yield sequence("list", data.length(), data.getValues(0, Math.min(data.length(), MAX_ELEMENTS)), depth, null);
                    }
                    case "java.util.LinkedList" -> {
                        int size = intField(object, "size");
                        List<Value> items = new ArrayList<>();
                        ObjectReference cursor = (ObjectReference) field(object, "first");
                        while (cursor != null && items.size() < MAX_ELEMENTS) {
                            Value[] node = fieldValues(cursor, "item", "next");
                            items.add(node[0]); cursor = (ObjectReference) node[1];
                        }
                        yield sequence("list", size, items, depth, null);
                    }
                    case "java.util.ArrayDeque" -> {
                        Value[] parts = fieldValues(object, "elements", "head", "tail");
                        ArrayReference elements = (ArrayReference) parts[0];
                        int head = ((IntegerValue) parts[1]).value(), tail = ((IntegerValue) parts[2]).value(), capacity = elements.length();
                        int size = capacity == 0 ? 0 : Math.floorMod(tail - head, capacity);
                        List<Value> items = new ArrayList<>();
                        for (int i = 0; i < Math.min(size, MAX_ELEMENTS); i++) items.add(elements.getValue((head + i) % capacity));
                        yield sequence("list", size, items, depth, "Shown from head (first) to tail (last).");
                    }
                    case "java.util.PriorityQueue" -> {
                        int size = intField(object, "size");
                        ArrayReference queue = (ArrayReference) field(object, "queue");
                        yield sequence("list", size, queue.getValues(0, Math.min(size, Math.min(MAX_ELEMENTS, queue.length()))), depth, "Internal heap order: index 0 is the head; the rest is not sorted.");
                    }
                    case "java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap" -> {
                        List<Value[]> entries = mapEntries(object, type);
                        List<Object> out = new ArrayList<>();
                        for (Value[] entry : entries) out.add(map("key", value(entry[0], depth), "value", value(entry[1], depth)));
                        int size = intField(object, "size");
                        yield map("kind", "map", "length", size, "entries", out, "truncated", size > out.size());
                    }
                    case "java.util.Stack", "java.util.Vector" -> {
                        int size = intField(object, "elementCount");
                        ArrayReference data = (ArrayReference) field(object, "elementData");
                        yield sequence("list", size, data.getValues(0, Math.min(size, Math.min(MAX_ELEMENTS, data.length()))), depth, type.equals("java.util.Stack") ? "Bottom first: the top of the stack is the last element." : null);
                    }
                    // List.of, Set.of and Map.of return unmodifiable collections with compact layouts.
                    case "java.util.ImmutableCollections$ListN" -> {
                        ArrayReference data = (ArrayReference) field(object, "elements");
                        yield sequence("list", data.length(), data.getValues(0, Math.min(data.length(), MAX_ELEMENTS)), depth, "Unmodifiable (List.of).");
                    }
                    case "java.util.ImmutableCollections$List12", "java.util.ImmutableCollections$Set12" -> {
                        Value[] parts = fieldValues(object, "e0", "e1");
                        List<Value> items = new ArrayList<>(List.of(parts[0]));
                        if (!isEmptySentinel(object, parts[1])) items.add(parts[1]);
                        yield sequence(type.endsWith("List12") ? "list" : "set", items.size(), items, depth, type.endsWith("List12") ? "Unmodifiable (List.of)." : "Unmodifiable (Set.of); the order is not defined.");
                    }
                    case "java.util.ImmutableCollections$SetN" -> {
                        ArrayReference data = (ArrayReference) field(object, "elements");
                        List<Value> items = new ArrayList<>();
                        for (Value v : data.getValues()) if (v != null && items.size() < MAX_ELEMENTS) items.add(v);
                        yield sequence("set", intField(object, "size"), items, depth, "Unmodifiable (Set.of); the order is not defined.");
                    }
                    case "java.util.ImmutableCollections$Map1" -> {
                        Value[] parts = fieldValues(object, "k0", "v0");
                        yield map("kind", "map", "length", 1, "entries", List.of(map("key", value(parts[0], depth), "value", value(parts[1], depth))), "truncated", false, "message", "Unmodifiable (Map.of).");
                    }
                    case "java.util.ImmutableCollections$MapN" -> {
                        ArrayReference table = (ArrayReference) field(object, "table");
                        List<Value> slots = table.getValues();
                        List<Object> out = new ArrayList<>();
                        for (int i = 0; i + 1 < slots.size() && out.size() < MAX_ELEMENTS; i += 2) if (slots.get(i) != null) out.add(map("key", value(slots.get(i), depth), "value", value(slots.get(i + 1), depth)));
                        int size = intField(object, "size");
                        yield map("kind", "map", "length", size, "entries", out, "truncated", size > out.size(), "message", "Unmodifiable (Map.of); the order is not defined.");
                    }
                    // Collections.unmodifiableList/Set/Map wrap another collection: show the one inside.
                    case "java.util.Collections$UnmodifiableRandomAccessList", "java.util.Collections$UnmodifiableList", "java.util.Collections$UnmodifiableSet", "java.util.Collections$UnmodifiableCollection", "java.util.Collections$UnmodifiableMap" -> {
                        ObjectReference inner = (ObjectReference) field(object, type.endsWith("Map") ? "m" : "c");
                        Map<String, Object> view = inner == null ? null : library(inner, inner.referenceType().name(), depth);
                        String innerName = inner == null ? "" : inner.referenceType().name().replaceAll(".*\\.", "");
                        if (view != null) view.put("message", "Unmodifiable view of " + ("AEIOU".indexOf(innerName.isEmpty() ? 'x' : innerName.charAt(0)) >= 0 ? "an " : "a ") + innerName + ".");
                        yield view;
                    }
                    case "java.util.HashSet", "java.util.LinkedHashSet", "java.util.TreeSet" -> {
                        ObjectReference backing = (ObjectReference) field(object, type.equals("java.util.TreeSet") ? "m" : "map");
                        String backingType = backing.referenceType().name();
                        if (!List.of("java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap").contains(backingType)) yield null;
                        List<Value> keys = new ArrayList<>();
                        for (Value[] entry : mapEntries(backing, backingType)) keys.add(entry[0]);
                        yield sequence("set", intField(backing, "size"), keys, depth, null);
                    }
                    case "java.lang.StringBuilder", "java.lang.StringBuffer" -> {
                        Value[] parts = fieldValues(object, "value", "coder", "count");
                        ArrayReference bytes = (ArrayReference) parts[0];
                        byte coder = ((ByteValue) parts[1]).value();
                        int count = ((IntegerValue) parts[2]).value();
                        int shown = Math.min(count, MAX_TEXT);
                        StringBuilder text = new StringBuilder(shown);
                        if (shown > 0 && coder == 0) {
                            for (Value b : bytes.getValues(0, shown)) text.append((char) (((ByteValue) b).value() & 0xff));
                        } else if (shown > 0) {
                            List<Value> raw = bytes.getValues(0, shown * 2);
                            boolean little = ByteOrder.nativeOrder() == ByteOrder.LITTLE_ENDIAN; // The target JVM runs on this host.
                            for (int i = 0; i < shown; i++) {
                                int a = ((ByteValue) raw.get(i * 2)).value() & 0xff, b = ((ByteValue) raw.get(i * 2 + 1)).value() & 0xff;
                                text.append((char) (little ? (a | b << 8) : (a << 8 | b)));
                            }
                        }
                        yield map("kind", "string", "text", text.toString(), "length", count, "truncated", count > shown);
                    }
                    // Views of a map: keySet(), values() and entrySet() read the map they belong to.
                    case "java.util.HashMap$KeySet", "java.util.LinkedHashMap$LinkedKeySet", "java.util.TreeMap$KeySet", "java.util.HashMap$Values", "java.util.LinkedHashMap$LinkedValues", "java.util.TreeMap$Values" -> {
                        ObjectReference owner = (ObjectReference) field(object, type.equals("java.util.TreeMap$KeySet") ? "m" : "this$0");
                        String ownerType = owner.referenceType().name();
                        if (!List.of("java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap").contains(ownerType)) yield null;
                        boolean keys = type.contains("KeySet");
                        List<Value> items = new ArrayList<>();
                        for (Value[] entry : ordered(object, mapEntries(owner, ownerType))) items.add(keys ? entry[0] : entry[1]);
                        yield sequence(keys ? "set" : "list", intField(owner, "size"), items, depth, keys ? "The map’s keys (keySet()). It is a view: it changes when the map changes." : "The map’s values (values()). It is a view: it changes when the map changes.");
                    }
                    case "java.util.HashMap$EntrySet", "java.util.LinkedHashMap$LinkedEntrySet", "java.util.TreeMap$EntrySet" -> {
                        ObjectReference owner = (ObjectReference) field(object, "this$0");
                        List<Object> out = new ArrayList<>();
                        for (Value[] entry : ordered(object, mapEntries(owner, owner.referenceType().name()))) out.add(map("key", value(entry[0], depth), "value", value(entry[1], depth)));
                        int size = intField(owner, "size");
                        yield map("kind", "map", "length", size, "entries", out, "truncated", size > out.size(), "message", "The map’s entries (entrySet()). It is a view: it changes when the map changes.");
                    }
                    case "java.util.HashMap$Node", "java.util.HashMap$TreeNode", "java.util.LinkedHashMap$Entry", "java.util.TreeMap$Entry", "java.util.AbstractMap$SimpleEntry", "java.util.AbstractMap$SimpleImmutableEntry", "java.util.KeyValueHolder" -> {
                        Value[] parts = fieldValues(object, "key", "value");
                        yield map("kind", "map", "entries", List.of(map("key", value(parts[0], depth), "value", value(parts[1], depth))), "message", "One map entry: getKey() → getValue().");
                    }
                    // Iterators: what they iterate over and what next() returns.
                    case "java.util.ArrayList$Itr", "java.util.ArrayList$ListItr" -> {
                        Value[] parts = fieldValues(object, "cursor", "this$0");
                        ObjectReference list = (ObjectReference) parts[1];
                        int cursor = ((IntegerValue) parts[0]).value(), size = intField(list, "size");
                        ArrayReference data = (ArrayReference) field(list, "elementData");
                        yield iterator(list, cursor < size ? data.getValue(cursor) : null, cursor < size, cursor, depth);
                    }
                    case "java.util.LinkedList$ListItr" -> {
                        Value[] parts = fieldValues(object, "next", "nextIndex", "this$0");
                        ObjectReference next = (ObjectReference) parts[0];
                        yield iterator((ObjectReference) parts[2], next == null ? null : field(next, "item"), next != null, ((IntegerValue) parts[1]).value(), depth);
                    }
                    case "java.util.HashMap$KeyIterator", "java.util.HashMap$ValueIterator", "java.util.HashMap$EntryIterator", "java.util.LinkedHashMap$LinkedKeyIterator", "java.util.LinkedHashMap$LinkedValueIterator", "java.util.LinkedHashMap$LinkedEntryIterator", "java.util.TreeMap$KeyIterator", "java.util.TreeMap$ValueIterator", "java.util.TreeMap$EntryIterator" -> {
                        ObjectReference next = (ObjectReference) field(object, "next");
                        Value shown = next == null ? null : field(next, type.contains("Value") ? "value" : "key");
                        // Entry iterators return the entry itself, so show it.
                        if (type.contains("Entry")) shown = next;
                        yield iterator((ObjectReference) field(object, "this$0"), shown, next != null, -1, depth);
                    }
                    case "java.util.ArrayDeque$DeqIterator" -> {
                        Value[] parts = fieldValues(object, "cursor", "remaining", "this$0");
                        ObjectReference deque = (ObjectReference) parts[2];
                        int cursor = ((IntegerValue) parts[0]).value(), remaining = ((IntegerValue) parts[1]).value();
                        ArrayReference elements = (ArrayReference) field(deque, "elements");
                        yield iterator(deque, remaining > 0 ? elements.getValue(cursor) : null, remaining > 0, -1, depth);
                    }
                    case "java.util.Optional" -> {
                        Value inner = field(object, "value");
                        yield inner == null ? map("kind", "object", "fields", List.of(), "message", "Optional.empty(): there is no value.")
                            : map("kind", "object", "fields", List.of(map("name", "java.util.Optional.value", "type", inner.type().name(), "value", value(inner, depth))), "message", "An Optional with a value: get() returns it.");
                    }
                    case "java.util.OptionalInt", "java.util.OptionalLong", "java.util.OptionalDouble" -> {
                        Value[] parts = fieldValues(object, "isPresent", "value");
                        yield ((BooleanValue) parts[0]).value() ? map("kind", "value", "text", type.replace("java.util.", "") + "[" + parts[1] + "]") : map("kind", "value", "text", type.replace("java.util.", "") + ".empty");
                    }
                    case "java.util.BitSet" -> {
                        Value[] parts = fieldValues(object, "words", "wordsInUse");
                        int inUse = ((IntegerValue) parts[1]).value(), count = 0;
                        List<Object> bits = new ArrayList<>();
                        if (inUse > 0) {
                            List<Value> words = ((ArrayReference) parts[0]).getValues(0, inUse);
                            for (int w = 0; w < inUse; w++) {
                                long word = ((LongValue) words.get(w)).value();
                                count += Long.bitCount(word);
                                for (long rest = word; rest != 0 && bits.size() < MAX_ELEMENTS; rest &= rest - 1) {
                                    bits.add(map("kind", "primitive", "type", "int", "value", String.valueOf(w * 64 + Long.numberOfTrailingZeros(rest))));
                                }
                            }
                        }
                        yield map("kind", "set", "length", count, "elements", bits, "truncated", count > bits.size(), "message", "The indexes of the bits that are set, smallest first.");
                    }
                    case "java.util.Collections$EmptyList", "java.util.Collections$EmptySet" -> sequence(type.endsWith("List") ? "list" : "set", 0, List.of(), depth, "An empty, unmodifiable " + (type.endsWith("List") ? "list" : "set") + ".");
                    case "java.util.Collections$EmptyMap" -> map("kind", "map", "length", 0, "entries", List.of(), "truncated", false, "message", "An empty, unmodifiable map.");
                    case "java.util.Collections$SingletonList", "java.util.Collections$SingletonSet" -> sequence(type.endsWith("List") ? "list" : "set", 1, List.of(field(object, "element")), depth, "A one-element, unmodifiable " + (type.endsWith("List") ? "list" : "set") + ".");
                    case "java.util.Collections$SingletonMap" -> {
                        Value[] parts = fieldValues(object, "k", "v");
                        yield map("kind", "map", "length", 1, "entries", List.of(map("key", value(parts[0], depth), "value", value(parts[1], depth))), "truncated", false, "message", "A one-entry, unmodifiable map.");
                    }
                    case "java.util.ArrayList$SubList" -> {
                        Value[] parts = fieldValues(object, "root", "offset", "size");
                        int offset = ((IntegerValue) parts[1]).value(), size = ((IntegerValue) parts[2]).value();
                        ArrayReference data = (ArrayReference) field((ObjectReference) parts[0], "elementData");
                        yield sequence("list", size, data.getValues(offset, Math.min(size, MAX_ELEMENTS)), depth, "A view of part of another list (subList). Changes write through to that list.");
                    }
                    case "java.util.EnumMap" -> {
                        Value[] parts = fieldValues(object, "keyUniverse", "vals", "size");
                        List<Value> keys = ((ArrayReference) parts[0]).getValues(), vals = ((ArrayReference) parts[1]).getValues();
                        List<Object> out = new ArrayList<>();
                        for (int i = 0; i < keys.size() && out.size() < MAX_ELEMENTS; i++) if (vals.get(i) != null) out.add(map("key", value(keys.get(i), depth), "value", value(vals.get(i), depth)));
                        int size = ((IntegerValue) parts[2]).value();
                        yield map("kind", "map", "length", size, "entries", out, "truncated", size > out.size(), "message", "Kept in the order the constants are declared.");
                    }
                    case "java.util.RegularEnumSet", "java.util.JumboEnumSet" -> {
                        Value[] parts = fieldValues(object, "universe", "elements");
                        List<Value> universe = ((ArrayReference) parts[0]).getValues();
                        List<Value> items = new ArrayList<>();
                        long[] words = parts[1] instanceof LongValue one ? new long[] { one.value() } : ((ArrayReference) parts[1]).getValues().stream().mapToLong(v -> ((LongValue) v).value()).toArray();
                        for (int i = 0; i < universe.size() && items.size() < MAX_ELEMENTS; i++) if ((words[i / 64] & (1L << (i % 64))) != 0) items.add(universe.get(i));
                        yield sequence("set", items.size(), items, depth, "Kept in the order the constants are declared.");
                    }
                    case "java.util.concurrent.atomic.AtomicInteger", "java.util.concurrent.atomic.AtomicLong" -> map("kind", "value", "text", field(object, "value").toString());
                    case "java.util.concurrent.atomic.AtomicBoolean" -> map("kind", "value", "text", String.valueOf(intField(object, "value") != 0));
                    case "java.math.BigInteger" -> map("kind", "value", "text", clip(bigInteger(object).toString(), MAX_TEXT));
                    case "java.math.BigDecimal" -> {
                        Value[] parts = fieldValues(object, "intVal", "intCompact", "scale");
                        int scale = ((IntegerValue) parts[2]).value();
                        java.math.BigDecimal number = parts[0] == null ? java.math.BigDecimal.valueOf(((LongValue) parts[1]).value(), scale) : new java.math.BigDecimal(bigInteger((ObjectReference) parts[0]), scale);
                        yield map("kind", "value", "text", number.toString());
                    }
                    case "java.util.UUID" -> {
                        Value[] parts = fieldValues(object, "mostSigBits", "leastSigBits");
                        yield map("kind", "value", "text", new UUID(((LongValue) parts[0]).value(), ((LongValue) parts[1]).value()).toString());
                    }
                    case "java.time.LocalDate", "java.time.LocalTime", "java.time.LocalDateTime", "java.time.Instant", "java.time.Duration", "java.time.Period", "java.time.YearMonth", "java.time.Year", "java.time.ZonedDateTime", "java.time.OffsetDateTime", "java.time.ZoneOffset", "java.time.ZoneRegion" -> map("kind", "value", "text", time(object, type));
                    default -> enumConstant(object);
                };
            } catch (RuntimeException unexpectedLayout) {
                return null;
            }
        }

        /** An iterator as two or three named parts: the collection, what next() returns, and the next index. */
        Map<String, Object> iterator(ObjectReference over, Value next, boolean hasNext, int index, int depth) {
            List<Object> fields = new ArrayList<>();
            fields.add(map("name", "iterator.over", "type", over.referenceType().name(), "value", value(over, depth)));
            if (hasNext) fields.add(map("name", "iterator.next", "type", next == null ? "null" : next.type().name(), "value", value(next, depth)));
            if (index >= 0) fields.add(map("name", "iterator.nextIndex", "type", "int", "value", map("kind", "primitive", "type", "int", "value", String.valueOf(index))));
            return map("kind", "object", "fields", fields, "truncated", false,
                "message", hasNext ? "An iterator. next() returns the value shown as next, then moves on." : "An iterator at the end: hasNext() is false.");
        }

        /** LinkedHashMap's reversed() views keep a flag and walk the entries backwards. */
        List<Value[]> ordered(ObjectReference view, List<Value[]> entries) {
            Field reversed = view.referenceType().fieldByName("reversed");
            if (reversed != null && view.getValue(reversed) instanceof BooleanValue b && b.value()) Collections.reverse(entries);
            return entries;
        }

        /** Constants of JDK enums (TimeUnit, DayOfWeek, …) by name. */
        Map<String, Object> enumConstant(ObjectReference object) {
            if (!(object.referenceType() instanceof ClassType type) || !isLibraryType(type.name())) return null;
            boolean isEnum = type.isEnum() || (type.superclass() != null && type.superclass().isEnum());
            if (!isEnum || !(field(object, "name") instanceof StringReference name)) return null;
            return map("kind", "value", "text", name.value());
        }

        Map<String, Object> sequence(String kind, int size, List<Value> items, int depth, String message) {
            Map<String, Object> node = map("kind", kind, "length", size, "elements", values(items, depth), "truncated", size > items.size());
            if (message != null) node.put("message", message);
            return node;
        }

        List<Value[]> mapEntries(ObjectReference map, String type) {
            List<Value[]> entries = new ArrayList<>();
            if (type.equals("java.util.TreeMap")) {
                Deque<ObjectReference> stack = new ArrayDeque<>();
                ObjectReference cursor = (ObjectReference) field(map, "root");
                int visits = 0;
                while ((cursor != null || !stack.isEmpty()) && entries.size() < MAX_ELEMENTS && visits++ < MAX_ELEMENTS * 8) {
                    while (cursor != null && stack.size() < 64) { stack.push(cursor); cursor = (ObjectReference) field(cursor, "left"); }
                    ObjectReference node = stack.pop();
                    Value[] parts = fieldValues(node, "key", "value", "right");
                    entries.add(new Value[] { parts[0], parts[1] });
                    cursor = (ObjectReference) parts[2];
                }
            } else if (type.equals("java.util.LinkedHashMap")) {
                ObjectReference cursor = (ObjectReference) field(map, "head");
                while (cursor != null && entries.size() < MAX_ELEMENTS) {
                    Value[] parts = fieldValues(cursor, "key", "value", "after");
                    entries.add(new Value[] { parts[0], parts[1] });
                    cursor = (ObjectReference) parts[2];
                }
            } else {
                ArrayReference table = (ArrayReference) field(map, "table");
                if (table == null) return entries;
                for (int start = 0; start < table.length() && entries.size() < MAX_ELEMENTS; start += 256) {
                    for (Value bucket : table.getValues(start, Math.min(256, table.length() - start))) {
                        ObjectReference cursor = (ObjectReference) bucket;
                        while (cursor != null && entries.size() < MAX_ELEMENTS) {
                            Value[] parts = fieldValues(cursor, "key", "value", "next");
                            entries.add(new Value[] { parts[0], parts[1] });
                            cursor = (ObjectReference) parts[2];
                        }
                        if (entries.size() >= MAX_ELEMENTS) break;
                    }
                }
            }
            return entries;
        }
    }

    private static int intOf(Value value) { return ((PrimitiveValue) value).intValue(); }
    private static long longOf(Value value) { return ((PrimitiveValue) value).longValue(); }

    private static java.math.BigInteger bigInteger(ObjectReference object) {
        Value[] parts = fieldValues(object, "signum", "mag");
        List<Value> mag = ((ArrayReference) parts[1]).getValues();
        byte[] bytes = new byte[mag.size() * 4];
        for (int i = 0; i < mag.size(); i++) {
            int word = intOf(mag.get(i));
            for (int b = 0; b < 4; b++) bytes[i * 4 + b] = (byte) (word >>> (24 - 8 * b));
        }
        return new java.math.BigInteger(intOf(parts[0]), bytes);
    }

    private static java.time.LocalDate localDate(ObjectReference o) {
        Value[] p = fieldValues(o, "year", "month", "day");
        return java.time.LocalDate.of(intOf(p[0]), intOf(p[1]), intOf(p[2]));
    }
    private static java.time.LocalTime localTime(ObjectReference o) {
        Value[] p = fieldValues(o, "hour", "minute", "second", "nano");
        return java.time.LocalTime.of(intOf(p[0]), intOf(p[1]), intOf(p[2]), intOf(p[3]));
    }
    private static String zoneId(ObjectReference zone) { return field(zone, "id") instanceof StringReference id ? id.value() : "?"; }

    /** java.time values as their toString() text, rebuilt from fields with the worker's own java.time. */
    private static String time(ObjectReference o, String type) {
        return switch (type) {
            case "java.time.LocalDate" -> localDate(o).toString();
            case "java.time.LocalTime" -> localTime(o).toString();
            case "java.time.LocalDateTime" -> java.time.LocalDateTime.of(localDate((ObjectReference) field(o, "date")), localTime((ObjectReference) field(o, "time"))).toString();
            case "java.time.Instant" -> { Value[] p = fieldValues(o, "seconds", "nanos"); yield java.time.Instant.ofEpochSecond(longOf(p[0]), intOf(p[1])).toString(); }
            case "java.time.Duration" -> { Value[] p = fieldValues(o, "seconds", "nanos"); yield java.time.Duration.ofSeconds(longOf(p[0]), intOf(p[1])).toString(); }
            case "java.time.Period" -> { Value[] p = fieldValues(o, "years", "months", "days"); yield java.time.Period.of(intOf(p[0]), intOf(p[1]), intOf(p[2])).toString(); }
            case "java.time.YearMonth" -> { Value[] p = fieldValues(o, "year", "month"); yield java.time.YearMonth.of(intOf(p[0]), intOf(p[1])).toString(); }
            case "java.time.Year" -> String.valueOf(intOf(field(o, "year")));
            case "java.time.ZoneOffset", "java.time.ZoneRegion" -> zoneId(o);
            case "java.time.OffsetDateTime" -> time((ObjectReference) field(o, "dateTime"), "java.time.LocalDateTime") + zoneId((ObjectReference) field(o, "offset"));
            default -> {
                // ZonedDateTime: local date-time, offset, then the region in brackets unless the zone is the offset.
                ObjectReference zone = (ObjectReference) field(o, "zone"), offset = (ObjectReference) field(o, "offset");
                String text = time((ObjectReference) field(o, "dateTime"), "java.time.LocalDateTime") + zoneId(offset);
                yield zone.equals(offset) || zone.referenceType().name().equals("java.time.ZoneOffset") ? text : text + "[" + zoneId(zone) + "]";
            }
        };
    }

    static final Set<String> PRIMITIVES = Set.of("int", "long", "short", "byte", "char", "boolean", "double", "float");
    static final Set<String> BOXED = Set.of("java.lang.Integer", "java.lang.Long", "java.lang.Short", "java.lang.Byte", "java.lang.Character", "java.lang.Boolean", "java.lang.Double", "java.lang.Float");
    /** Contents of boxed objects already read, by object ID. */
    private final Map<Long, Map<String, Object>> boxed = new HashMap<>();

    private static boolean isLibraryType(String type) {
        return type.startsWith("java.") || type.startsWith("javax.") || type.startsWith("jdk.") || type.startsWith("sun.") || type.startsWith("com.sun.");
    }
    private static Value field(ObjectReference object, String name) {
        Field field = object.referenceType().fieldByName(name);
        if (field == null) throw new IllegalStateException("Unexpected layout: missing " + name);
        return object.getValue(field);
    }
    private static int intField(ObjectReference object, String name) { return ((IntegerValue) field(object, name)).value(); }
    /** ImmutableCollections marks the unused second slot of a one-element List12/Set12 with a shared EMPTY object. */
    private static boolean isEmptySentinel(ObjectReference owner, Value value) {
        if (value == null) return false;
        for (ReferenceType type : owner.virtualMachine().classesByName("java.util.ImmutableCollections")) {
            Field empty = type.fieldByName("EMPTY");
            if (empty != null && empty.isStatic()) return value.equals(type.getValue(empty));
        }
        return value.type() != null && value.type().name().equals("java.lang.Object");
    }
    /** Reads several fields with one debugger round trip. */
    private static Value[] fieldValues(ObjectReference object, String... names) {
        ReferenceType type = object.referenceType();
        List<Field> fields = new ArrayList<>();
        for (String name : names) {
            Field field = type.fieldByName(name);
            if (field == null) throw new IllegalStateException("Unexpected layout: missing " + name);
            fields.add(field);
        }
        Map<Field, Value> values = object.getValues(fields);
        Value[] out = new Value[names.length];
        for (int i = 0; i < names.length; i++) out[i] = values.get(fields.get(i));
        return out;
    }

    private Thread pump(InputStream input, String stream) { return pump(input, stream, null); }

    /** Streams output as events, within the shared output budget. `copy` keeps the first 8 KiB for inspection. */
    private Thread pump(InputStream input, String stream, StringBuilder copy) {
        Thread thread = new Thread(() -> {
            try (Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
                char[] buffer = new char[1024];
                int count;
                while ((count = reader.read(buffer)) >= 0) {
                    if (copy != null && copy.length() < 8192) synchronized (copy) { copy.append(buffer, 0, Math.min(count, 8192 - copy.length())); }
                    int before = outputChars.getAndAdd(count);
                    int allowed = Math.min(count, Math.max(0, 32768 - before));
                    if (allowed > 0) emit(map("kind", "output", "stream", stream, "text", new String(buffer, 0, allowed)));
                    if (allowed < count) outputTruncated = true;
                }
            } catch (IOException ignored) { }
        }, "student-" + stream);
        thread.setDaemon(true); thread.start(); return thread;
    }

    private boolean cancelled() { return Files.exists(workspace.resolve("cancel")); }
    private synchronized void stopTarget() {
        if (target == null) return;
        target.descendants().forEach(p -> { try { p.destroyForcibly(); } catch (Exception ignored) { } });
        if (target.isAlive()) {
            target.destroyForcibly();
            try { target.waitFor(700, TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
    }
    private void finish(String reason) { emit(map("kind", "terminated", "stopReason", reason, "message", stopMessage(reason))); }
    private static String stopMessage(String reason) {
        return switch (reason) {
            case "completed" -> "Program finished.";
            case "exception" -> "An uncaught exception ended this run.";
            case "step-limit" -> "Step budget reached. The recorded steps are available for replay.";
            case "timeout" -> "Time budget reached. The recorded steps are available for replay.";
            case "cancelled" -> "Run stopped. The recorded steps are available for replay.";
            case "unsupported-concurrency" -> "Multiple user threads were detected. This prototype traces single-threaded programs only.";
            case "output-limit" -> "The program printed more than 32,768 characters and was stopped.";
            case "compiled" -> "The program compiles.";
            case "bad-start" -> "The start condition can’t be read.";
            default -> "The JVM exited without completing normally. See stderr.";
        };
    }
    private static String clip(String text, int limit) { return text.length() <= limit ? text : text.substring(0, limit) + "…"; }

    static Map<String, Object> map(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }
    private static synchronized void emit(Map<String, Object> event) { System.out.println(json(event)); System.out.flush(); }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        if (value instanceof Map<?, ?> map) {
            StringJoiner join = new StringJoiner(",", "{", "}");
            map.forEach((key, v) -> join.add(json(key.toString()) + ":" + json(v))); return join.toString();
        }
        if (value instanceof Iterable<?> iterable) {
            StringJoiner join = new StringJoiner(",", "[", "]");
            iterable.forEach(v -> join.add(json(v))); return join.toString();
        }
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\""); case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n"); case '\r' -> out.append("\\r"); case '\t' -> out.append("\\t");
                default -> { if (c < 32 || Character.isSurrogate(c)) out.append(String.format("\\u%04x", (int)c)); else out.append(c); }
            }
        }
        return out.append('"').toString();
    }
}
