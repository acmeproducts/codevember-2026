import * as THREE from "three/webgpu";
import { Fn, If, Loop, exp, float, instanceIndex, instancedArray, int, max, min, uniform, uniformArray, vec2, vec4 } from "three/tsl";
import { CANVAS } from "./pendulum";
import { createCpuPaint } from "./paintCpu";
import { logEvent } from "../shared/engine/log";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// The paint on the canvas, simulated on the graphics card as a thin film over a grid of columns.
//
// Each column holds how thick the paint stands on it and the paint's colour there, and how wet it still is. Paint lands
// where the stream's parcels come down, spread a little along the way they were moving. Then, a few times a frame, it
// flows: wet paint runs from a column to a lower neighbour, but only by however much the step between them exceeds what
// the paint can hold up by itself (its yield stress), so a fresh line slumps into a rounded ridge and then stands; and it
// runs more freely the thicker it is (a viscous film moves as the square of its depth), so a pool spreads and a thin
// skin barely moves. Colour goes with the paint that carries it, mixed by volume where wet meets wet; over dry paint it
// lies as its own layer. Paint dries in seconds, thin paint first, and dry paint no longer flows. Every column is worked
// out by its own thread; nothing comes back to the processor.

// Most landings taken in one frame.
export const LANDINGS = 96;
// The swing's step, which landings are spaced by.
const STEP = 1 / 240;

// A square of paint SIZE wide: the canvas, or the floor round it.
export function createPaint(N: number, SIZE = CANVAS, webgl = false, smooth = true) {
  const CELLS = N * N;
  const CELL = SIZE / N;
  // Per column: thickness in metres, and the paint's colour; how wet it is (0 to 1) and how freshly it landed.
  const cells = instancedArray(CELLS, "vec4");
  const wet = instancedArray(CELLS, "vec4");
  // On WebGL2 the paint is worked out by the processor and shown to the picture as two ordinary textures, the plainest
  // thing a graphics card is ever asked to read.
  const sheet = () => {
    const texture = new THREE.DataTexture(new Float32Array(CELLS * 4), N, N, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  const maps = webgl ? { cells: sheet(), wet: sheet() } : null;
  const next = instancedArray(CELLS, "vec4");
  const nextWet = instancedArray(CELLS, "vec4");
  // How much leaves each column toward -x, +x, -z and +z this step.
  const flux = instancedArray(CELLS, "vec4");

  const u = {
    // This frame's landings: x, z, volume (cubic metres) and the stream's radius; and how they were moving (x, z) and,
    // for a sheet from the slot, half its width along the slot (x, z), else zero.
    landings: uniformArray(
      Array.from({ length: LANDINGS }, () => new THREE.Vector4()),
      "vec4"
    ),
    moving: uniformArray(
      Array.from({ length: LANDINGS }, () => new THREE.Vector4()),
      "vec4"
    ),
    count: uniform(0, "int"),
    colour: uniform(new THREE.Color("#f4efe6")),
    // The step paint can hold up by itself, in metres across one column; how freely it runs at a reference thickness, per
    // step; and how much of its wetness it loses per step, at that thickness.
    yieldStep: uniform(0.00035),
    mobility: uniform(0.16),
    drying: uniform(0.00004),
    wipe: uniform(0)
  };

  const clampI = (i: any) => (max as any)((min as any)(i, int(N - 1)), int(0));
  const at = (i: any, j: any) => clampI(j).mul(N).add(clampI(i));
  const place = () => {
    const id = int(instanceIndex);
    return { id, i: id.mod(N), j: id.div(N) };
  };
  const centre = (i: any, j: any) => vec2(float(i).add(0.5).mul(CELL).sub(SIZE / 2), float(j).add(0.5).mul(CELL).sub(SIZE / 2));

  // Paint coming down: each landing's volume spread over a small round patch, drawn out the way it was moving, so a fast
  // swing lays a stroke rather than a dot. A gaussian of reach s holds pi s^2 of area, which sets its height.
  const land = Fn(() => {
    const { id, i, j } = place();
    const c = cells.element(id) as any;
    const w = wet.element(id) as any;
    const p = centre(i, j) as any;
    const added = float(0).toVar();
    Loop(u.count, ({ i: k }: any) => {
      const l = u.landings.element(k) as any;
      const m = u.moving.element(k) as any;
      // A sheet lands as a band: measured from the nearest point on its width rather than from its middle.
      const off = p.sub(l.xy) as any;
      const seg = m.zw as any;
      const t = off.dot(seg).div(max(seg.dot(seg), float(1e-12))).clamp(-1, 1) as any;
      const d = off.sub(seg.mul(t)) as any;
      const speed = m.xy.length() as any;
      const way = m.xy.div(max(speed, float(1e-4))) as any;
      const a = d.x.mul(way.x).add(d.y.mul(way.y)) as any;
      const b = d.x.mul(way.y).sub(d.y.mul(way.x)) as any;
      const reach = max(l.w.mul(1.5), float(CELL * 1.1)) as any;
      // Drawn out along the way it moved by about the distance the stream covers in a step, so landings from a fast
      // swing join into one stroke rather than a string of beads.
      const along = reach.add(speed.mul(STEP * 1.1)) as any;
      const fall = exp(a.mul(a).div(along.mul(along)).add(b.mul(b).div(reach.mul(reach))).negate()) as any;
      // Its volume over the patch's area: the drawn-out spot, and the band swept along the sheet's width.
      const area = reach.mul(along).mul(Math.PI).add(seg.length().mul(2 * Math.sqrt(Math.PI)).mul(reach)) as any;
      added.addAssign(l.z.mul(fall).div(area));
    });
    If(added.greaterThan(0), () => {
      const total = c.x.add(added) as any;
      // New paint mixes with what is still wet under it, but lies over dry paint as a layer of its own colour: the
      // paint below counts toward the colour only as much as it is still wet.
      const under = c.x.mul(w.x.mul(w.x).max(0.02)) as any;
      const colour = c.yzw.mul(under).add(u.colour.mul(added)).div(max(under.add(added), float(1e-12))) as any;
      cells.element(id).assign(vec4(total, colour));
      wet.element(id).assign(vec4(min(w.x.mul(c.x).add(added).div(max(total, float(1e-9))), float(1)), min(w.y.add(added.mul(4000)), float(1)), w.z, w.w));
    });
  })().compute(CELLS);

  // How much each column gives each lower neighbour this step: the step beyond what the paint holds up, times how freely
  // it runs at this thickness and wetness; never more in all than a fifth of what it has.
  const REF = 0.0015;
  const flow = Fn(() => {
    const { id, i, j } = place();
    const h = cells.element(id).x as any;
    const w = wet.element(id).x as any;
    const run = u.mobility.mul(min(h.div(REF).mul(h.div(REF)), float(4))).mul(w).mul(w) as any;
    const give = (n: any) => max(h.sub(cells.element(n).x).sub(u.yieldStep), float(0)).mul(run).mul(0.5) as any;
    const out = vec4(give(at(i.sub(1), j)), give(at(i.add(1), j)), give(at(i, j.sub(1))), give(at(i, j.add(1)))) as any;
    const total = out.x.add(out.y).add(out.z).add(out.w) as any;
    flux.element(id).assign(out.mul(min(float(1), h.mul(0.2).div(max(total, float(1e-12))))));
  })().compute(CELLS);

  // Each column after the step: what came in from its neighbours, carrying their colour and wetness, less what left;
  // then a little drier, thin paint fastest.
  const settle = Fn(() => {
    const { id, i, j } = place();
    const c = cells.element(id) as any;
    const w = wet.element(id) as any;
    const f = flux.element(id) as any;
    const kept = c.x.sub(f.x.add(f.y).add(f.z).add(f.w)) as any;
    // Colour by what shows: wet paint running over a dry column covers it, so the dry paint there counts only a little.
    const showing = kept.mul(w.x.mul(w.x).max(0.02)) as any;
    const colour = c.yzw.mul(showing).toVar();
    const weight = showing.toVar();
    const wetness = w.x.mul(kept).toVar();
    const total = kept.toVar();
    const take = (n: any, part: any) => {
      const o = cells.element(n) as any;
      total.addAssign(part);
      weight.addAssign(part);
      colour.addAssign(o.yzw.mul(part));
      wetness.addAssign(wet.element(n).x.mul(part));
    };
    take(at(i.sub(1), j), flux.element(at(i.sub(1), j)).y);
    take(at(i.add(1), j), flux.element(at(i.add(1), j)).x);
    take(at(i, j.sub(1)), flux.element(at(i, j.sub(1))).w);
    take(at(i, j.add(1)), flux.element(at(i, j.add(1))).z);
    const inv = float(1).div(max(total, float(1e-12))) as any;
    const thin = float(1).add(float(REF).div(max(total, float(REF * 0.05)))) as any;
    const keep = float(1).sub(u.wipe) as any;
    // Off the edge of the canvas the paint is gone (it runs onto the floor).
    const edge = i.lessThan(1).or(j.lessThan(1)).or(i.greaterThan(N - 2)).or(j.greaterThan(N - 2)) as any;
    const h = edge.select(float(0), total.mul(keep)) as any;
    next.element(id).assign(vec4(h, (weight as any).greaterThan(1e-12).select(colour.div(weight), c.yzw)));
    nextWet.element(id).assign(vec4((max as any)(wetness.mul(inv).sub(u.drying.mul(thin)), float(0)).mul(keep), w.y.mul(0.97), w.z, w.w));
  })().compute(CELLS);

  const copy = Fn(() => {
    cells.element(instanceIndex).assign(next.element(instanceIndex));
    wet.element(instanceIndex).assign(nextWet.element(instanceIndex));
  })().compute(CELLS);

  // Paint the frame's landings (this.landings filled by the scene), then let it flow.
  let cpu: ((flows: number) => boolean) | null = null;
  let steps = 0;
  let spent = 0;
  let firstLanding = false;
  const step = (renderer: THREE.WebGPURenderer, flows: number) => {
    // On WebGL2 the passes below cannot run (they read and write the same columns), so the processor does them.
    if ((renderer as any).backend?.isWebGLBackend) {
      cpu ??= createCpuPaint({ N, SIZE, CELL, REF, STEP, cellsAttr: { array: maps!.cells.image.data as Float32Array }, wetAttr: { array: maps!.wet.image.data as Float32Array }, u: u as any });
      const began = performance.now();
      const changed = cpu(flows);
      if (changed) {
        maps!.cells.needsUpdate = true;
        maps!.wet.needsUpdate = true;
      }
      spent += performance.now() - began;
      steps++;
      const first = !firstLanding && u.count.value > 0;
      if (first) firstLanding = true;
      if (steps % 240 === 1 || first || (firstLanding && steps % 60 === 1 && steps < 600)) {
        let thick = 0;
        const data = maps!.cells.image.data as Float32Array;
        for (let o = 0; o < data.length; o += 4) thick += data[o];
        logEvent(`paint on the processor (${SIZE === CANVAS ? "canvas" : "floor"} ${N}x${N}): step ${steps}, ${(spent / steps).toFixed(2)} ms a step, ${(thick * 1e6).toFixed(1)} cm3 on it, ${u.count.value} landings this frame`);
      }
      return;
    }
    const passes: THREE.ComputeNode[] = [];
    if (u.count.value > 0) passes.push(land);
    for (let k = 0; k < flows; k++) passes.push(flow, settle, copy);
    renderer.compute(passes as any);
  };

  // Run once while loading, landings and all, so no pass has its pipeline built for the first time mid-visit.
  const warm = (renderer: THREE.WebGPURenderer) => {
    if ((renderer as any).backend?.isWebGLBackend) return;
    renderer.compute([land, flow, settle, copy] as any);
  };

  const made = { N, SIZE, CELL, cells, wet, maps, u, step, warm };
  ((globalThis as any).__cvPaints ??= []).push(made);
  return made;
}

export type Paint = ReturnType<typeof createPaint>;
