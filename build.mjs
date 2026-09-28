// build.mjs — bundles src/ into a single self-contained index.html.
// Strategy: each module becomes an IIFE returning its exports (a registry object).
// Relative imports are rewritten to destructuring from the registry; the bare
// `three` import is hoisted and resolved by an import map (CDN) in the HTML shell.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, 'src');

// dependency order (each may only reference earlier registries)
const ORDER = [
  ['M_vec3',        'core/vec3.js'],
  ['M_input',       'core/input.js'],
  ['M_flightModel', 'core/flightModel.js'],
  ['M_worldGen',    'core/worldGen.js'],
  ['M_gameLogic',   'core/gameLogic.js'],
  ['M_hud',         'ui/hud.js'],
  ['M_engineSound', 'audio/engineSound.js'],
  ['M_threeAdapter','render/threeAdapter.js'],
  ['M_main',        'main.js'],
];

const regByFile = {};
for (const [reg, file] of ORDER) regByFile[file] = reg;

// resolve a relative import specifier from an importing file to a src-relative path
function resolveSpec(importerRel, spec) {
  const base = path.posix.dirname(importerRel);
  return path.posix.normalize(path.posix.join(base, spec));
}

function transform(fileRel, source) {
  const lines = source.split('\n');
  const out = [];
  const imports = [];   // {names: 'a, b as c', from: './x.js'}
  const bareImports = [];
  const exports_ = new Set();

  for (const line of lines) {
    let m;
    if ((m = line.match(/^\s*import\s*\{([^}]+)\}\s*from\s*'([^']+)'\s*;?/))) {
      imports.push({ names: m[1], from: m[2] });
      continue;
    }
    if ((m = line.match(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'\s*;?/))) {
      bareImports.push(`import * as ${m[1]} from '${m[2]}'`);
      continue;
    }
    if ((m = line.match(/^\s*export\s+(?:function|const)\s+(\w+)/))) {
      exports_.add(m[1]);
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    out.push(line);
  }

  const importLines = [];
  for (const imp of imports) {
    if (!imp.from.startsWith('.')) throw new Error(`non-relative import '${imp.from}' in ${fileRel}`);
    const resolved = resolveSpec(fileRel, imp.from);
    const reg = regByFile[resolved];
    if (!reg) throw new Error(`unknown module '${resolved}' (imported by ${fileRel})`);
    const names = imp.names.split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
      const parts = spec.split(/\s+as\s+/);
      return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : spec;
    });
    importLines.push(`const {${names.join(', ')}} = ${reg};`);
  }

  const body = out.join('\n');
  const retList = [...exports_];
  return {
    code: `const ${regByFile[fileRel]} = (() => {\n${importLines.join('\n')}\n${body}\nreturn {${retList.join(', ')}};\n})();`,
    bareImports,
  };
}

let bundle = '';
const allBare = new Set();
for (const [reg, fileRel] of ORDER) {
  const source = readFileSync(path.join(srcDir, fileRel), 'utf8');
  const { code, bareImports } = transform(fileRel, source);
  bundle += `\n/* ===== ${fileRel} (${reg}) ===== */\n` + code + '\n';
  for (const b of bareImports) allBare.add(b);
}

const css = readFileSync(path.join(srcDir, 'ui/style.css'), 'utf8');
const threeUrl = 'https://unpkg.com/three@0.160.0/build/three.module.js';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Skyward — low-poly arcade flight</title>
<style>
${css}
</style>
<script type="importmap">
{ "imports": { "three": "${threeUrl}" } }
</script>
</head>
<body>
<canvas id="skyward-canvas"></canvas>
<div id="skyward-ui"></div>
<script type="module">
${[...allBare].join('\n')}

${bundle}
</script>
</body>
</html>
`;

writeFileSync(path.join(root, 'index.html'), html);
console.log('wrote index.html', (html.length / 1024).toFixed(1), 'KB');
