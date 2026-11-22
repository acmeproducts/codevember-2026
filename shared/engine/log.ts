// A running log of what the page does, kept on the device so that a crash can be read afterwards (the test page shows
// it). Entries are written the moment they happen, since a crash can end the page, or the browser's graphics, at once.
const KEY = "cv-log";
const MAX = 200;
let lines: string[] | null = null;
let started = 0;
let installed = false;

function read(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function logEvent(text: string) {
  try {
    lines ??= read();
    const t = ((performance.now() - started) / 1000).toFixed(1).padStart(5);
    lines.push(`${t}s ${text}`.slice(0, 220));
    if (lines.length > MAX) lines.splice(0, lines.length - MAX);
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
}

export const recentLog = (count = 8) => {
  lines ??= read();
  return lines.slice(-count);
};

// Marks the start of a visit and begins catching what the browser and three.js report.
export function startLog(label: string) {
  started = performance.now();
  logEvent(`==== ${label} · ${new Date().toISOString()} · ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 90)}`);
  if (installed) return;
  installed = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logEvent(`${level}: ${args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)?.slice(0, 120))).join(" ").slice(0, 200)}`);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => logEvent(`uncaught: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => logEvent(`unhandled: ${String((e.reason as Error)?.message ?? e.reason).slice(0, 200)}`));
  window.addEventListener("pagehide", () => logEvent("page left"));
  document.addEventListener("visibilitychange", () => logEvent(`page ${document.visibilityState}`));
  document.addEventListener("webglcontextlost", () => logEvent("WebGL context lost"), true);
}
