// Replicates languageApps.ts resolution (env fallback -> default) to verify
// what URL each language selection navigates to.
function externalAppUrl(lang, env = {}) {
  const map = {
    c: null,
    java: env.VITE_JAVA_APP_URL ?? "http://localhost:5173",
    python: env.VITE_PYTHON_APP_URL ?? "http://localhost:8000",
  };
  return map[lang];
}

const cases = [
  ["c (default)", "c", {}],
  ["java (default)", "java", {}],
  ["python (default)", "python", {}],
  ["java (env override)", "java", { VITE_JAVA_APP_URL: "http://10.0.0.5:5173" }],
  ["python (env override)", "python", { VITE_PYTHON_APP_URL: "http://10.0.0.5:8000" }],
];

for (const [label, lang, env] of cases) {
  const url = externalAppUrl(lang, env);
  const action = url === null ? "STAY in-app (handle C here)" : `NAVIGATE -> ${url}`;
  console.log(`${label.padEnd(24)} => ${action}`);
}
