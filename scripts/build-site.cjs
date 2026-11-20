const fs = require('node:fs');
const path = require('node:path');

const project = fs.realpathSync(path.join(__dirname, '..'));
const output = path.resolve(project, 'dist');
// The only removable directory is this project's own, non-symlink dist folder.
if (path.dirname(output) !== project || path.basename(output) !== 'dist') throw new Error('Invalid build output directory');
if (fs.existsSync(output)) {
  if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Refusing to clean a symlinked build directory');
  fs.rmSync(output, { recursive: true });
}
fs.mkdirSync(output);

const files = [
  'index.html', 'styles.css', 'app.js', 'forecast-core.js', 'favicon.svg',
  'bathymetry.css', 'bathymetry-core.js', 'bathymetry-map.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/LICENSE'
];
for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(project, file), destination);
}
console.log(`Static site ready: dist/ (${files.length} files)`);
