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
    static final int MAX_FRAMES = 24, MAX_LOCALS = 32, MAX_OBJECTS = 64, MAX_DEPTH = 12;
    static final int MAX_ELEMENTS = 32, MAX_FIELDS = 24, MAX_STATICS = 32, MAX_RETURNS = 8, MAX_TEXT = 512;

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
                        if (userThread == -1) userThread = e.thread().uniqueID();
                        if (userThread != e.thread().uniqueID()) { stopReason = "unsupported-concurrency"; done = true; break; }
                        snapshot(e.thread(), e.location(), null);
                        if (++steps >= maxSteps) { stopReason = "step-limit"; done = true; break; }
                    } else if (event instanceof ExceptionEvent e) {
                        Location sourceLocation = userLocation(e.thread());
                        boolean caught = e.catchLocation() != null;
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
        emit(map("kind", "terminated", "stopReason", stopReason, "steps", steps, "exitCode", exitCode,
            "outputTruncated", outputTruncated, "message", stopMessage(stopReason)));
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
        enter.addClassFilter(type); enter.setSuspendPolicy(EventRequest.SUSPEND_ALL); enter.enable();
        MethodExitRequest exit = manager.createMethodExitRequest();
        exit.addClassFilter(type); exit.setSuspendPolicy(EventRequest.SUSPEND_ALL); exit.enable();
        try {
            Set<String> seen = new HashSet<>();
            for (Location location : type.allLineLocations()) {
                String key = methodKey(location.method()) + ":" + location.codeIndex();
                if (!seen.add(key)) continue;
                BreakpointRequest bp = manager.createBreakpointRequest(location);
                bp.setSuspendPolicy(EventRequest.SUSPEND_ALL); bp.enable();
            }
        } catch (AbsentInformationException ignored) { }
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
            for (Field field : type.fields()) {
                if (field.isStatic() && !field.isSynthetic() && statics.size() < MAX_STATICS) {
                    try { statics.add(map("name", type.name() + "." + field.name(), "type", field.typeName(), "value", capture.value(type.getValue(field), 0))); }
                    catch (RuntimeException ignored) { }
                }
            }
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
                        node.put("elements", values(array.getValues(0, Math.min(array.length(), MAX_ELEMENTS)), depth));
                        node.put("truncated", array.length() > MAX_ELEMENTS);
                    } else {
                        Map<String, Object> library = library(object, type, depth);
                        if (library != null) node.putAll(library);
                        else if (isLibraryType(type) && !type.matches("java\\.lang\\.(Integer|Long|Short|Byte|Double|Float|Boolean|Character)")) {
                            node.put("kind", "opaque");
                            node.put("message", "Library internals are hidden. Strings, arrays, boxed values, lists, maps, sets, deques and StringBuilder have dedicated views.");
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
                    default -> null;
                };
            } catch (RuntimeException unexpectedLayout) {
                return null;
            }
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

    private static boolean isLibraryType(String type) {
        return type.startsWith("java.") || type.startsWith("javax.") || type.startsWith("jdk.") || type.startsWith("sun.") || type.startsWith("com.sun.");
    }
    private static Value field(ObjectReference object, String name) {
        Field field = object.referenceType().fieldByName(name);
        if (field == null) throw new IllegalStateException("Unexpected layout: missing " + name);
        return object.getValue(field);
    }
    private static int intField(ObjectReference object, String name) { return ((IntegerValue) field(object, name)).value(); }
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
