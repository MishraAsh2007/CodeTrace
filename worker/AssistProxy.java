import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.stream.Stream;

/**
 * Forwards one HTTP request for the AI assistant and streams the response, so the Rust runner needs no TLS stack.
 * Input on stdin: the method, the URL, header lines, a blank line, then the body. The API key arrives as a header
 * on stdin, never on the command line. Output on stdout: "S <status>", then "L <line>" per response line, then "D";
 * "E <message>" reports a failure.
 */
public class AssistProxy {
    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        try {
            String method = in.readLine();
            String url = in.readLine();
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(180));
            for (String header = in.readLine(); header != null && !header.isEmpty(); header = in.readLine()) {
                int colon = header.indexOf(':');
                if (colon > 0) request.header(header.substring(0, colon).trim(), header.substring(colon + 1).trim());
            }
            StringBuilder body = new StringBuilder();
            char[] buffer = new char[8192];
            for (int n = in.read(buffer); n >= 0; n = in.read(buffer)) body.append(buffer, 0, n);
            request.method(method, body.isEmpty() ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
            HttpResponse<Stream<String>> response = client.send(request.build(), HttpResponse.BodyHandlers.ofLines());
            out.println("S " + response.statusCode());
            try (Stream<String> lines = response.body()) { lines.forEach(line -> out.println("L " + line)); }
            out.println("D");
        } catch (java.net.ConnectException e) {
            out.println("E Could not connect. Is the AI server running at that address?");
        } catch (java.net.http.HttpTimeoutException e) {
            out.println("E The AI server did not answer in time.");
        } catch (Exception e) {
            out.println("E " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()).replace('\n', ' '));
        }
    }
}
