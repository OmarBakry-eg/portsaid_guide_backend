// Safe deep-array accessor. Walks a nested array along `path` indices,
// returning undefined as soon as any link is missing. Tolerates `null`
// segments (Google emits a lot of those).
export function pick(arr, ...path) {
  let cur = arr;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Find the first non-null element in a nested array matching a predicate.
// Used to locate the results list regardless of where Google nests it.
export function findArray(root, predicate, maxDepth = 6) {
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (Array.isArray(node)) {
      if (predicate(node)) return node;
      if (depth < maxDepth) {
        for (const child of node) stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return null;
}

// Google's XHR responses come in two transports:
//   (A) raw: `)]}'\n<json-array>`
//   (B) chunked wrapper: `{"c":0,"d":"<escaped-json-array-with-)]}-prefix>","e":...}`
// We normalize both into the parsed array.
export function parseGoogleResponse(text) {
  // Detect chunked wrapper.
  if (text.trimStart().startsWith('{"c"')) {
    // Google appends a JS comment terminator `/*""*/` after the JSON wrapper —
    // it's a leftover from the days when the response was eval'd as script.
    // Strip everything from the final `}` to end.
    const lastBrace = text.lastIndexOf('}');
    const jsonText = lastBrace >= 0 ? text.slice(0, lastBrace + 1) : text;
    const wrapper = JSON.parse(jsonText);
    const inner = (wrapper.d ?? '').replace(/^\)\]\}'\s*/, '');
    return JSON.parse(inner);
  }
  const cleaned = text.replace(/^\)\]\}'\s*/, '');
  return JSON.parse(cleaned);
}
