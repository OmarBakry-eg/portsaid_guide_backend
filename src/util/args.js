export function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [key, ...rest] = raw.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  }
  return args;
}

export function parseLl(ll) {
  // Format: "@lat,lon,zoomz" or "@lat,lon,zoom.zz"
  const m = /^@?(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z?$/.exec(ll || '');
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), zoom: parseFloat(m[3]) };
}
