/** Deterministic, dependency-free unified diff (Myers) over normalized text. */
const maxEditDistance = 4000;

function lines(text: string): string[] {
  const result = text.split('\n');
  if (result[result.length - 1] === '') result.pop();
  return result;
}

type Op = '=' | '-' | '+';

function myers(x: string[], y: string[]): Op[] | null {
  const n = x.length;
  const m = y.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // Bound time and trace memory; callers fall back to a whole replacement hunk.
    if (d > maxEditDistance || d * v.length > 20_000_000) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1] ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i++; j++; }
      v[offset + k] = i;
      if (i >= n && j >= m) {
        const ops: Op[] = [];
        let cx = n;
        let cy = m;
        for (let step = d; step >= 0; step--) {
          const previous = trace[step];
          const ck = cx - cy;
          const pk = ck === -step || ck !== step && previous[offset + ck - 1] < previous[offset + ck + 1] ? ck + 1 : ck - 1;
          const px = previous[offset + pk];
          const py = px - pk;
          while (cx > px && cy > py) { ops.push('='); cx--; cy--; }
          if (step > 0) ops.push(cx === px ? '+' : '-');
          cx = px;
          cy = py;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}

export function unifiedDiff(before: string, after: string, context = 3): string {
  const x = lines(before);
  const y = lines(after);
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
  let suffix = 0;
  while (suffix < x.length - prefix && suffix < y.length - prefix && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix++;
  const middleX = x.slice(prefix, x.length - suffix);
  const middleY = y.slice(prefix, y.length - suffix);
  const middle = myers(middleX, middleY) ?? [...middleX.map((): Op => '-'), ...middleY.map((): Op => '+')];
  const ops: Op[] = [...Array(prefix).fill('='), ...middle, ...Array(suffix).fill('=')];
  // Attach line numbers to each operation.
  const rows: { op: Op; a: number; b: number; text: string }[] = [];
  let a = 0;
  let b = 0;
  for (const op of ops) {
    if (op === '=') rows.push({ op, a: a++, b: b++, text: x[a - 1] });
    else if (op === '-') rows.push({ op, a: a++, b, text: x[a - 1] });
    else rows.push({ op, a, b: b++, text: y[b - 1] });
  }
  const changed = rows.map((row, index) => row.op === '=' ? -1 : index).filter(index => index >= 0);
  if (!changed.length) return before === after ? '' : '@@ trailing newline changed @@\n';
  const hunks: string[] = [];
  let start = 0;
  while (start < changed.length) {
    let end = start;
    while (end + 1 < changed.length && changed[end + 1] - changed[end] <= context * 2 + 1) end++;
    const from = Math.max(0, changed[start] - context);
    const to = Math.min(rows.length - 1, changed[end] + context);
    const slice = rows.slice(from, to + 1);
    const oldCount = slice.filter(row => row.op !== '+').length;
    const newCount = slice.filter(row => row.op !== '-').length;
    const oldStart = oldCount ? slice.find(row => row.op !== '+')!.a + 1 : slice[0].a;
    const newStart = newCount ? slice.find(row => row.op !== '-')!.b + 1 : slice[0].b;
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const row of slice) hunks.push(`${row.op === '=' ? ' ' : row.op}${row.text}`);
    start = end + 1;
  }
  return hunks.join('\n') + '\n';
}
