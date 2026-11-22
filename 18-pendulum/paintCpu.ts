import type * as THREE from "three/webgpu";

// The paint simulation again, worked out by the processor, for a phone whose graphics run through WebGL2. There the
// calculations that paint is made with cannot run on the graphics card (a pass cannot read and write the same
// columns), so the phone's own processor does the same sums on the same arrays and the picture reads them as before.
// It is the same simulation as paint.ts, step for step: landings, flow, settle, dry.

type Vec4 = { x: number; y: number; z: number; w: number };
type Sim = {
  N: number;
  SIZE: number;
  CELL: number;
  REF: number;
  STEP: number;
  cellsAttr: { array: Float32Array };
  wetAttr: { array: Float32Array };
  u: {
    landings: { array: Vec4[] };
    moving: { array: Vec4[] };
    count: { value: number };
    colour: { value: THREE.Color };
    yieldStep: { value: number };
    mobility: { value: number };
    drying: { value: number };
    wipe: { value: number };
  };
};

export function createCpuPaint(sim: Sim) {
  const { N, SIZE, CELL, REF, STEP, u } = sim;
  // The graphics library swaps each attribute's array for a padded one when it builds the shaders that read it, so the
  // arrays are taken afresh at every step.
  let cells = sim.cellsAttr.array;
  let wet = sim.wetAttr.array;
  const CELLS = N * N;
  const next = new Float32Array(CELLS * 4);
  const nextWet = new Float32Array(CELLS * 4);
  const flux = new Float32Array(CELLS * 4);
  const added = new Float32Array(CELLS);
  const touched = new Int32Array(CELLS);
  // The part of the grid that has paint on or beside it, so quiet corners cost nothing.
  let lo = N, hi = -1, loJ = N, hiJ = -1;
  let dirty = false;

  const clamp = (v: number) => (v < 0 ? 0 : v > N - 1 ? N - 1 : v);
  const grow = (i0: number, j0: number, i1: number, j1: number) => {
    if (i0 < lo) lo = i0;
    if (i1 > hi) hi = i1;
    if (j0 < loJ) loJ = j0;
    if (j1 > hiJ) hiJ = j1;
  };

  function land() {
    const count = u.count.value;
    if (count <= 0) return;
    let touchedCount = 0;
    const colour = u.colour.value;
    for (let k = 0; k < count; k++) {
      const l = u.landings.array[k];
      const m = u.moving.array[k];
      const segX = m.z, segY = m.w;
      const segLen = Math.hypot(segX, segY);
      const speed = Math.hypot(m.x, m.y);
      const wayX = m.x / Math.max(speed, 1e-4), wayY = m.y / Math.max(speed, 1e-4);
      const reach = Math.max(l.w * 1.5, CELL * 1.1);
      const along = reach + speed * STEP * 1.1;
      const area = reach * along * Math.PI + segLen * 2 * Math.sqrt(Math.PI) * reach;
      const segDot = Math.max(segX * segX + segY * segY, 1e-12);
      // Out to where the falloff is under a ten-thousandth, which is as far as the paint is worth working out.
      const radius = 3 * Math.max(along, reach) + segLen;
      const half = Math.ceil(radius / CELL);
      const ci = Math.floor((l.x + SIZE / 2) / CELL), cj = Math.floor((l.y + SIZE / 2) / CELL);
      const i0 = Math.max(0, ci - half), i1 = Math.min(N - 1, ci + half);
      const j0 = Math.max(0, cj - half), j1 = Math.min(N - 1, cj + half);
      if (i0 > i1 || j0 > j1) continue;
      grow(i0, j0, i1, j1);
      for (let j = j0; j <= j1; j++) {
        const pz = (j + 0.5) * CELL - SIZE / 2;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) * CELL - SIZE / 2;
          const ox = px - l.x, oy = pz - l.y;
          let t = (ox * segX + oy * segY) / segDot;
          t = t < -1 ? -1 : t > 1 ? 1 : t;
          const dx = ox - segX * t, dy = oy - segY * t;
          const a = dx * wayX + dy * wayY;
          const b = dx * wayY - dy * wayX;
          const fall = Math.exp(-(a * a / (along * along) + b * b / (reach * reach)));
          const id = j * N + i;
          if (added[id] === 0) touched[touchedCount++] = id;
          added[id] += (l.z * fall) / area;
        }
      }
    }
    const cr = colour.r, cg = colour.g, cb = colour.b;
    for (let n = 0; n < touchedCount; n++) {
      const id = touched[n];
      const add = added[id];
      added[id] = 0;
      if (!(add > 0)) continue;
      const o = id * 4;
      const h = cells[o];
      const wx = wet[o];
      const total = h + add;
      const under = h * Math.max(wx * wx, 0.02);
      const denom = Math.max(under + add, 1e-12);
      cells[o] = total;
      cells[o + 1] = (cells[o + 1] * under + cr * add) / denom;
      cells[o + 2] = (cells[o + 2] * under + cg * add) / denom;
      cells[o + 3] = (cells[o + 3] * under + cb * add) / denom;
      wet[o] = Math.min((wx * h + add) / Math.max(total, 1e-9), 1);
      wet[o + 1] = Math.min(wet[o + 1] + add * 4000, 1);
    }
    dirty = true;
  }

  function flow(i0: number, i1: number, j0: number, j1: number) {
    const yieldStep = u.yieldStep.value, mobility = u.mobility.value;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const id = j * N + i, o = id * 4;
        const h = cells[o];
        if (h <= 0) {
          flux[o] = flux[o + 1] = flux[o + 2] = flux[o + 3] = 0;
          continue;
        }
        const w = wet[o];
        const q = h / REF;
        const run = mobility * Math.min(q * q, 4) * w * w;
        const hl = cells[(j * N + clamp(i - 1)) * 4], hr = cells[(j * N + clamp(i + 1)) * 4];
        const hd = cells[(clamp(j - 1) * N + i) * 4], hu = cells[(clamp(j + 1) * N + i) * 4];
        const gl = Math.max(h - hl - yieldStep, 0) * run * 0.5;
        const gr = Math.max(h - hr - yieldStep, 0) * run * 0.5;
        const gd = Math.max(h - hd - yieldStep, 0) * run * 0.5;
        const gu = Math.max(h - hu - yieldStep, 0) * run * 0.5;
        const total = gl + gr + gd + gu;
        const scale = Math.min(1, (h * 0.2) / Math.max(total, 1e-12));
        flux[o] = gl * scale;
        flux[o + 1] = gr * scale;
        flux[o + 2] = gd * scale;
        flux[o + 3] = gu * scale;
      }
    }
  }

  function settle(i0: number, i1: number, j0: number, j1: number) {
    const drying = u.drying.value, keep = 1 - u.wipe.value;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const id = j * N + i, o = id * 4;
        const left = (j * N + clamp(i - 1)) * 4, right = (j * N + clamp(i + 1)) * 4;
        const down = (clamp(j - 1) * N + i) * 4, up = (clamp(j + 1) * N + i) * 4;
        const f = flux[o] + flux[o + 1] + flux[o + 2] + flux[o + 3];
        const kept = cells[o] - f;
        const wx = wet[o];
        const showing = kept * Math.max(wx * wx, 0.02);
        let r = cells[o + 1] * showing, g = cells[o + 2] * showing, b = cells[o + 3] * showing;
        let weight = showing, wetness = wx * kept, total = kept;
        const take = (n: number, part: number) => {
          total += part;
          weight += part;
          r += cells[n + 1] * part;
          g += cells[n + 2] * part;
          b += cells[n + 3] * part;
          wetness += wet[n] * part;
        };
        take(left, flux[left + 1]);
        take(right, flux[right]);
        take(down, flux[down + 3]);
        take(up, flux[up + 2]);
        const inv = 1 / Math.max(total, 1e-12);
        const thin = 1 + REF / Math.max(total, REF * 0.05);
        const edge = i < 1 || j < 1 || i > N - 2 || j > N - 2;
        next[o] = edge ? 0 : total * keep;
        if (weight > 1e-12) {
          next[o + 1] = r / weight;
          next[o + 2] = g / weight;
          next[o + 3] = b / weight;
        } else {
          next[o + 1] = cells[o + 1];
          next[o + 2] = cells[o + 2];
          next[o + 3] = cells[o + 3];
        }
        nextWet[o] = Math.max(wetness * inv - drying * thin, 0) * keep;
        nextWet[o + 1] = wet[o + 1] * 0.97;
        nextWet[o + 2] = wet[o + 2];
        nextWet[o + 3] = wet[o + 3];
      }
    }
  }

  // One step: this frame's landings, then flows of flow, settle and copy. Returns whether the arrays changed.
  return function step(flows: number) {
    cells = sim.cellsAttr.array;
    wet = sim.wetAttr.array;
    land();
    if (u.wipe.value > 0) {
      lo = 0; hi = N - 1; loJ = 0; hiJ = N - 1;
      dirty = true;
    }
    if (hi < lo || hiJ < loJ) return false;
    for (let k = 0; k < flows; k++) {
      // Paint can run one column a step.
      const i0 = Math.max(0, lo - 1), i1 = Math.min(N - 1, hi + 1), j0 = Math.max(0, loJ - 1), j1 = Math.min(N - 1, hiJ + 1);
      flow(i0, i1, j0, j1);
      settle(i0, i1, j0, j1);
      for (let j = j0; j <= j1; j++) {
        const from = (j * N + i0) * 4, to = (j * N + i1 + 1) * 4;
        cells.set(next.subarray(from, to), from);
        wet.set(nextWet.subarray(from, to), from);
      }
      lo = i0; hi = i1; loJ = j0; hiJ = j1;
    }
    const changed = dirty || flows > 0;
    dirty = false;
    return changed;
  };
}
