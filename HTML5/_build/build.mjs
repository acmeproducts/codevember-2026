// Builds every day as one self-contained HTML file in HTML5/, with an index.html listing them.
// Code, styles, fonts and physics are inside each file. Scanned textures and models stay where they are in
// public/assets and are fetched by relative path, so the repo must be served from its root (as GitHub Pages does).
//
//   npm i
//   npm i --no-save esbuild @fontsource-variable/karla @fontsource-variable/darker-grotesque
//   node HTML5/_build/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = resolve(here, "..");
const slugs = readdirSync(root).filter((name) => /^\d\d-[a-z]+$/.test(name)).sort();
const only = process.argv.slice(2);

const font = (file) => readFileSync(join(root, "node_modules/@fontsource-variable", file)).toString("base64");
const face = (family, file, weight, style = "normal") =>
  `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${font(file)}) format("woff2")}`;
const fonts =
  face("Darker Grotesque", "darker-grotesque/files/darker-grotesque-latin-wght-normal.woff2", "300 900") +
  face("Karla", "karla/files/karla-latin-wght-normal.woff2", "200 800") +
  face("Karla", "karla/files/karla-latin-wght-italic.woff2", "200 800", "italic") +
  `:root{--font-display:"Darker Grotesque";--font-body:"Karla"}`;

// Site-absolute paths become relative to HTML5/, and each page carries only its own day.
const standalone = (slug) => ({
  name: "standalone",
  setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation|dynamic)$/ }, (args) => ({ path: join(here, `next-${args.path.slice(5)}.ts${args.path.endsWith("navigation") ? "" : "x"}`) }));
    b.onLoad({ filter: /\.tsx?$/ }, (args) => {
      if (args.path.includes("node_modules")) return;
      let contents = readFileSync(args.path, "utf8");
      if (slug && args.path === join(root, "shared/registry.ts")) {
        contents = `import type { DayDefinition } from "./engine/types";\nexport const dayLoaders: Record<string, () => Promise<{ default: DayDefinition }>> = { "${slug}": () => import("../${slug}") };\n`;
      }
      contents = contents.replace(/(["'`(])\/(assets|posters)\//g, "$1../public/$2/");
      return { contents, loader: args.path.endsWith("x") ? "tsx" : "ts" };
    });
  }
});

const safe = (code, tag) => code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`).replace(/<!--/g, "<\\!--");

async function page(entry, slug, title, description) {
  const result = await build({
    entryPoints: [join(here, entry)],
    outdir: out,
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    legalComments: "none",
    tsconfig: join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', __SLUG__: JSON.stringify(slug ?? "") },
    plugins: [standalone(slug)],
    logLevel: "warning"
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description.replace(/"/g, "&quot;")}">
<style>${safe(fonts + css, "style")}</style>
</head>
<body>
<div class="cv-root"></div>
<noscript><p>${description} This needs JavaScript and a GPU.</p></noscript>
<script type="module">${safe(js, "script")}</script>
</body>
</html>
`;
  const name = `${slug ?? "index"}.html`;
  writeFileSync(join(out, name), html);
  console.log(name, (html.length / 1e6).toFixed(2) + " MB");
}

const { days, daySlug } = await (async () => {
  const r = await build({ entryPoints: [join(root, "shared/days.ts")], bundle: true, write: false, format: "esm" });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
})();

if (!only.length || only.includes("index")) await page("index.tsx", null, "Codevember 2026", "One word, one real-time 3D experience, every day of November 2026.");
for (const slug of slugs) {
  if (only.length && !only.includes(slug)) continue;
  const day = days.find((d) => daySlug(d) === slug);
  await page("day.tsx", slug, `${slug.slice(0, 2)} ${day.word} | Codevember`, day.blurb ?? "");
}
