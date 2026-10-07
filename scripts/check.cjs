const fs = require('fs');
const path = require('path');

const root = process.env.WUMA_CHECK_ROOT
  ? path.resolve(process.env.WUMA_CHECK_ROOT)
  : path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const subPackages = app.subPackages || app.subpackages || [];
const pageRoutes = [...app.pages, ...subPackages.flatMap(pkg =>
  pkg.pages.map(route => `${pkg.root.replace(/\/$/, '')}/${route}`))];
const errors = [];
const expectedPages = ['login', 'index', 'game', 'analysis', 'review', 'coach', 'training', 'history', 'profile', 'online'];
const seenPages = pageRoutes.map(route => route.split('/').pop());
for (const name of expectedPages) if (!seenPages.includes(name)) errors.push(`missing page: ${name}`);

const knownNative = new Set([
  'view', 'text', 'image', 'button', 'canvas', 'scroll-view', 'block',
  'switch', 'input', 'radio-group', 'label', 'radio', 'picker', 'slider', 'slot',
]);
const sourceDirs = [path.join(mini, 'pages'), path.join(mini, 'components'),
  ...subPackages.flatMap(pkg => [path.join(mini, pkg.root, 'pages'),
    path.join(mini, pkg.root, 'components')]).filter(dir => fs.existsSync(dir))];
let checked = 0;
for (const parent of sourceDirs) {
  for (const folder of fs.readdirSync(parent)) {
    const dir = path.join(parent, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    const base = path.join(dir, folder);
    for (const ext of ['json', 'wxml', 'wxss', 'ts']) if (!fs.existsSync(`${base}.${ext}`)) errors.push(`missing ${base}.${ext}`);
    if (!fs.existsSync(`${base}.json`) || !fs.existsSync(`${base}.wxml`)) continue;
    checked++;
    const config = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    const components = config.usingComponents || {};
    for (const [name, target] of Object.entries(components)) {
      const componentPath = path.resolve(dir, `${target}.json`);
      if (!fs.existsSync(componentPath)) errors.push(`unresolved component ${name} in ${folder}`);
    }
    const wxml = fs.readFileSync(`${base}.wxml`, 'utf8');
    const ts = fs.readFileSync(`${base}.ts`, 'utf8');
    const stack = [];
    const tags = /<(\/)?([a-z][a-z0-9-]*)\b([^>]*?)>/g;
    let match;
    while ((match = tags.exec(wxml))) {
      const [, closing, name, rest] = match;
      if (!knownNative.has(name) && !Object.prototype.hasOwnProperty.call(components, name)) errors.push(`unknown WXML tag <${name}> in ${folder}`);
      if (closing) {
        if (stack.pop() !== name) errors.push(`unbalanced WXML tag </${name}> in ${folder}`);
      } else if (!rest.trimEnd().endsWith('/')) stack.push(name);
    }
    if (stack.length) errors.push(`unclosed WXML tags in ${folder}: ${stack.join(', ')}`);
    for (const [, handler] of wxml.matchAll(/\bbind(?:tap|:[a-z-]+)="([a-zA-Z][a-zA-Z0-9]*)"/g)) {
      if (!new RegExp(`\\b${handler}\\s*\\(`).test(ts)) errors.push(`missing handler ${handler} in ${folder}`);
    }
    for (const [, asset] of wxml.matchAll(/\bsrc="(\.{1,2}\/[^"{}]+)"/g)) {
      if (!fs.existsSync(path.resolve(dir, asset))) errors.push(`missing asset ${asset} in ${folder}`);
    }
    const wxss = fs.readFileSync(`${base}.wxss`, 'utf8');
    if (/url\(['"]?\.\.?\//.test(wxss)) errors.push(`local image in WXSS: ${folder}`);
  }
}

for (const route of pageRoutes) {
  const base = path.join(mini, route);
  if (!fs.existsSync(`${base}.json`)) errors.push(`app page does not exist: ${route}`);
}
const allTs = pageRoutes.map(route => path.join(mini, `${route}.ts`))
  .filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
for (const [, route] of allTs.matchAll(/['"](\/(?:[a-z][a-z0-9-]*\/)*pages\/[a-z-]+\/[a-z-]+)(?:\?[^'"]*)?['"]/g)) {
  if (!pageRoutes.includes(route.slice(1))) errors.push(`unregistered navigation route: ${route}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Checked ${pageRoutes.length} registered pages and ${checked - pageRoutes.length} components: JSON, WXML tags, events, local assets, navigation routes.`);
