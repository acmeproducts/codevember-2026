// A running log of what the page does, kept on the device so that a crash can be read afterwards (the test page shows
// it). Entries are written the moment they happen, since a crash can end the page, or the browser's graphics, at once.
declare const __CV_BUILD__: string | undefined;
// When this copy of the page was built, so a report says which version it came from.
export const BUILD = typeof __CV_BUILD__ === "string" ? __CV_BUILD__ : "dev";
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

// The same thing over and over is written three times and then only counted, so it cannot push the useful lines out.
let lastKind = "";
let repeats = 0;
export function logEvent(text: string) {
  try {
    lines ??= read();
    const kind = text.replace(/\d+/g, "#").replace(/\[.*?\]|\(.*?\)/g, "").slice(0, 60);
    if (kind === lastKind) {
      if (++repeats > 2) return;
    } else {
      if (repeats > 2) lines.push(`       (the line above repeated ${repeats - 2} more times)`);
      lastKind = kind;
      repeats = 0;
    }
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
  logEvent(`==== ${label} · build ${BUILD} · ${new Date().toISOString()} · ${navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 90)}`);
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

// Whether the browser can still draw anything at all: a new, tiny canvas given one trivial shader. Tells a scene that
// breaks the graphics apart from a browser whose graphics are already switched off.
export function probeGraphics(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "a brand-new test canvas was refused too: the browser itself has graphics switched off right now";
    const make = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, make(gl.VERTEX_SHADER, "#version 300 es\nvoid main(){gl_Position=vec4(0.,0.,0.,1.);}"));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, "#version 300 es\nprecision mediump float;out vec4 o;void main(){o=vec4(1.);}"));
    gl.linkProgram(program);
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    const lostNow = gl.isContextLost();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (lostNow) return "a brand-new test canvas was lost at once: the browser's graphics are down right now";
    return linked ? "a brand-new test canvas works: the browser is fine, it is this scene that breaks it" : "a brand-new test canvas could not build even a trivial shader";
  } catch (e) {
    return `the test canvas failed: ${String((e as Error)?.message ?? e).slice(0, 80)}`;
  }
}
