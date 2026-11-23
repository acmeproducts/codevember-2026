"use client";

import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { color, float, mix, mx_noise_float, positionWorld, smoothstep, texture, uv, vec2, vec3 } from "three/tsl";
import { useDispose } from "../shared/engine/dispose";
import { lehmer } from "../shared/engine/random";
import { underCanvas } from "./canvas";
import { painting, ROOM, spills } from "./studio";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// The studio the canvas stands in: a white gallery loft with a seamless photographer's cyclorama behind the canvas and
// two big softboxes either side of it. Daylight is soft: a strong sky-and-ground fill does most of the lighting, one big
// light from the windows casts wide, soft shadows, and the softboxes fill in from the front; window glass and softbox
// faces glow past white so they bloom a little. Walls are built of solid pieces round their openings, so the sun only
// comes in where the windows are and draws their bars across the floor.

const ROOT = "/assets/18-pendulum";

// The gallery's tall windows, along its left wall (x = -width/2): each [centre along the wall, width], with their sill
// and head heights; and where its sun shines in from, toward the middle of the room.
export const WINDOWS = { openings: [[-3, 1.3], [-1, 1.3], [1, 1.3], [3, 1.3]] as [number, number][], sill: 0.45, head: 3.0, cols: 2, rows: 4 };
export const SUN: [number, number, number] = [-10, 6.5, 2.5];
const VIVID = ["#e8e3d8", "#f2efe8", "#b3192b", "#e0a21c", "#1f4fb8", "#2fae86", "#e0558b", "#151515", "#2a2a2a", "#7a7670"];

type Kit = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
};

function kit(): Kit & { keep: <T extends THREE.BufferGeometry>(g: T) => T; mat: <T extends THREE.Material>(m: T) => T; solid: (m: THREE.Material, size: [number, number, number], at: [number, number, number]) => THREE.Mesh } {
  const k = { group: new THREE.Group(), geometries: [] as THREE.BufferGeometry[], materials: [] as THREE.Material[], textures: [] as THREE.Texture[] };
  const keep = <T extends THREE.BufferGeometry>(g: T) => (k.geometries.push(g), g);
  const mat = <T extends THREE.Material>(m: T) => (k.materials.push(m), m);
  // A solid block: a wall piece, a sill, a bar. Casts and takes shadow.
  const solid = (m: THREE.Material, size: [number, number, number], at: [number, number, number]) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(...size)), m);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    k.group.add(mesh);
    return mesh;
  };
  return { ...k, keep, mat, solid };
}

// Plaster, mottled a little.
function plaster(k: ReturnType<typeof kit>, from: string, to: string) {
  const m = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.92 }));
  const mottle = mx_noise_float(positionWorld.mul(0.7)).mul(0.5).add(0.5) as any;
  const fine = mx_noise_float(positionWorld.mul(14)).mul(0.025) as any;
  m.colorNode = mix(color(from), color(to), mottle).add(fine) as any;
  return m;
}

// Daylight through glass: bright, cooler at the top, past white so it blooms.
function daylight(k: ReturnType<typeof kit>, top: string, bottom: string, power: number) {
  const m = k.mat(new THREE.MeshBasicNodeMaterial());
  m.colorNode = mix(color(bottom), color(top), uv().y).mul(power) as any;
  return m;
}

// The room's shell: floor, ceiling and the walls, each wall either solid or with window openings cut along it.
// openings: for the wall at -x ("left"), +x ("right") or -z ("back"), a list of [centre along the wall, width] with one
// sill and head height for the lot.
function shell(
  k: ReturnType<typeof kit>,
  room: { width: number; depth: number; height: number },
  floorMaterial: THREE.Material,
  wallMaterial: THREE.Material,
  ceilingMaterial: THREE.Material,
  windows: { wall: "left" | "right" | "back" | "front"; openings: [number, number][]; sill: number; head: number; glass: THREE.Material; bars: THREE.Material; cols: number; rows: number } | null,
  skylights: { at: [number, number, number, number][]; glass: THREE.Material; bars: THREE.Material } | null = null
) {
  const T = 0.2;
  const W = room.width;
  const D = room.depth;
  const H = room.height;
  const floorMesh = new THREE.Mesh(k.keep(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2)), floorMaterial);
  floorMesh.receiveShadow = true;
  k.group.add(floorMesh);

  // The ceiling, solid or cut round skylights (each [x, z, width along x, depth along z]).
  if (!skylights) k.solid(ceilingMaterial, [W + 2 * T, T, D + 2 * T], [0, H + T / 2, 0]);
  else {
    // Strips between the skylights: lay the ceiling as a grid of cells and leave out the ones under glass.
    const cell = 0.25;
    const nx = Math.round((W + 2 * T) / cell);
    const nz = Math.round((D + 2 * T) / cell);
    const open = (x: number, z: number) => skylights.at.some(([sx, sz, sw, sd]) => Math.abs(x - sx) < sw / 2 && Math.abs(z - sz) < sd / 2);
    // Merge each run of solid cells along x into one block.
    for (let j = 0; j < nz; j++) {
      const z = -D / 2 - T + (j + 0.5) * cell;
      let start = -1;
      for (let i = 0; i <= nx; i++) {
        const x = -W / 2 - T + (i + 0.5) * cell;
        const solidHere = i < nx && !open(x, z);
        if (solidHere && start < 0) start = i;
        if (!solidHere && start >= 0) {
          const x0 = -W / 2 - T + start * cell;
          const x1 = -W / 2 - T + i * cell;
          k.solid(ceilingMaterial, [x1 - x0, T, cell], [(x0 + x1) / 2, H + T / 2, z]);
          start = -1;
        }
      }
    }
    for (const [sx, sz, sw, sd] of skylights.at) {
      const pane = new THREE.Mesh(k.keep(new THREE.PlaneGeometry(sw, sd).rotateX(Math.PI / 2)), skylights.glass);
      pane.position.set(sx, H + T + 0.05, sz);
      k.group.add(pane);
      // Glazing bars across it.
      for (let b = 1; b < 4; b++) k.solid(skylights.bars, [0.04, 0.06, sd], [sx - sw / 2 + (b * sw) / 4, H + T * 0.6, sz]);
      k.solid(skylights.bars, [sw, 0.06, 0.04], [sx, H + T * 0.6, sz]);
    }
  }

  // A wall: along x for "back" (at z = -D/2), along z for left/right. Solid, or built round openings.
  const wall = (side: "left" | "right" | "back" | "front") => {
    const along = side === "back" || side === "front" ? W : D;
    const place = (u: number, y: number, length: number, height: number) => {
      if (side === "back") return k.solid(wallMaterial, [length, height, T], [u, y, -D / 2 - T / 2]);
      if (side === "front") return k.solid(wallMaterial, [length, height, T], [u, y, D / 2 + T / 2]);
      const x = side === "left" ? -W / 2 - T / 2 : W / 2 + T / 2;
      return k.solid(wallMaterial, [T, height, length], [x, y, u]);
    };
    if (!windows || windows.wall !== side) {
      place(0, H / 2, along + 2 * T, H);
      return;
    }
    const { openings, sill, head, glass, bars, cols, rows } = windows;
    place(0, sill / 2, along + 2 * T, sill);
    place(0, (head + H) / 2, along + 2 * T, H - head);
    // Piers between the openings.
    const edges = [-along / 2 - T, ...openings.flatMap(([c, w]) => [c - w / 2, c + w / 2]), along / 2 + T];
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e];
      const b = edges[e + 1];
      if (b - a > 0.01) place((a + b) / 2, (sill + head) / 2, b - a, head - sill);
    }
    // Glass just outside each opening, and its frame of glazing bars.
    for (const [c, w] of openings) {
      const h = head - sill;
      const pane = new THREE.Mesh(k.keep(new THREE.PlaneGeometry(w, h)), glass);
      const out = T + 0.25;
      if (side === "back") pane.position.set(c, (sill + head) / 2, -D / 2 - out);
      else if (side === "front") {
        pane.position.set(c, (sill + head) / 2, D / 2 + out);
        pane.rotation.y = Math.PI;
      } else {
        pane.position.set(side === "left" ? -W / 2 - out : W / 2 + out, (sill + head) / 2, c);
        pane.rotation.y = side === "left" ? Math.PI / 2 : -Math.PI / 2;
      }
      k.group.add(pane);
      const bar = (u: number, y: number, length: number, height: number) => {
        if (side === "back" || side === "front") return k.solid(bars, [length, height, 0.05], [u, y, side === "back" ? -D / 2 - T / 2 : D / 2 + T / 2]);
        return k.solid(bars, [0.05, height, length], [side === "left" ? -W / 2 - T / 2 : W / 2 + T / 2, y, u]);
      };
      for (let i = 1; i < cols; i++) bar(c - w / 2 + (i * w) / cols, (sill + head) / 2, 0.035, h);
      for (let j = 1; j < rows; j++) bar(c, sill + (j * h) / rows, w, 0.035);
    }
  };
  wall("left");
  wall("right");
  wall("back");
  wall("front");
}

// Finished paintings leaning on the walls.
function leaning(k: ReturnType<typeof kit>, spots: [number, number, number, number, number][], seed: number) {
  spots.forEach(([x, z, turn, size, lean], n) => {
    const art = painting(lighter() ? 512 : 1024, seed + n * 17);
    k.textures.push(art);
    const face = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.55 }));
    face.colorNode = texture(art).rgb as any;
    const edge = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }));
    edge.colorNode = color("#cfc3ae") as any;
    const board = new THREE.Mesh(k.keep(new THREE.BoxGeometry(size, size, 0.035)), [edge, edge, edge, edge, face, edge]);
    board.position.set(x, size / 2 - 0.02, z);
    board.rotation.set(0, turn, 0);
    board.rotateX(-lean);
    board.castShadow = board.receiveShadow = true;
    k.group.add(board);
  });
}

// The day's big light: a directional sun (or sky) from outside with wide, soft shadows over the room.
function sun(k: ReturnType<typeof kit>, colour: string, intensity: number, from: [number, number, number], softness: number) {
  const light = new THREE.DirectionalLight(colour, intensity);
  light.position.set(...from);
  light.target.position.set(0, 0, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(lighter() ? 1024 : 2048, lighter() ? 1024 : 2048);
  const c = light.shadow.camera;
  c.left = c.bottom = -7;
  c.right = c.top = 7;
  c.near = 0.5;
  c.far = 40;
  light.shadow.bias = -0.0006;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = softness;
  k.group.add(light, light.target);
  return light;
}

// Paint on a floor, drawn once: the spill texture laid across the room.
// In the lighter mode the room's pictures are made at half size: a quarter of the graphics memory, barely visible.
const lighter = () => Boolean((globalThis as { __cvLite?: boolean }).__cvLite);
function spillOn(k: ReturnType<typeof kit>, full: number, seed: number, colours?: string[]) {
  const size = lighter() ? Math.min(full, 2048) : full;
  const t = spills(size, seed, colours);
  k.textures.push(t);
  const across = positionWorld.xz.div(ROOM.width).add(0.5) as any;
  return texture(t, vec2(across.x, across.y.oneMinus())) as any;
}

// A long trestle table against a wall, with jars of brushes and tins on it.
function table(k: ReturnType<typeof kit>, at: [number, number, number], turn: number, wood: THREE.Material, seed: number) {
  const t = new THREE.Group();
  const top = new THREE.Mesh(k.keep(new THREE.BoxGeometry(2.2, 0.05, 0.7)), wood);
  top.position.y = 0.78;
  t.add(top);
  for (const sx of [-0.85, 0.85]) {
    for (const sz of [-0.25, 0.25]) {
      const leg = new THREE.Mesh(k.keep(new THREE.BoxGeometry(0.05, 0.76, 0.05)), wood);
      leg.position.set(sx, 0.38, sz);
      leg.rotation.z = sx > 0 ? -0.08 : 0.08;
      t.add(leg);
    }
  }
  const random = lehmer(seed);
  const glass = k.mat(new THREE.MeshPhysicalNodeMaterial({ roughness: 0.08, transmission: 0.6, thickness: 0.01, metalness: 0 }));
  glass.colorNode = color("#dfe7e6") as any;
  const tin = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.85 }));
  tin.colorNode = color("#b9b6ae") as any;
  const handle = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.6 }));
  handle.colorNode = color("#a8794b") as any;
  for (let n = 0; n < 9; n++) {
    const x = -0.95 + n * 0.23 + (random() - 0.5) * 0.06;
    const z = (random() - 0.5) * 0.35;
    const isJar = random() < 0.55;
    const r = isJar ? 0.045 : 0.06;
    const h = isJar ? 0.13 : 0.09;
    const pot = new THREE.Mesh(k.keep(new THREE.CylinderGeometry(r, r, h, 18)), isJar ? glass : tin);
    pot.position.set(x, 0.805 + h / 2, z);
    t.add(pot);
    if (isJar)
      for (let b = 0; b < 4; b++) {
        const brush = new THREE.Mesh(k.keep(new THREE.CylinderGeometry(0.004, 0.006, 0.26, 6)), handle);
        brush.position.set(x + (random() - 0.5) * 0.04, 0.805 + 0.15, z + (random() - 0.5) * 0.04);
        brush.rotation.set((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4);
        t.add(brush);
      }
  }
  t.position.set(...at);
  t.rotation.y = turn;
  t.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
  k.group.add(t);
}

// The cyclorama: a seamless white sweep, the floor curving up into a wall with no edge between, standing behind the
// canvas across the room from the eye. Its foot lies on the floor and takes the floor's paint, so the two meet unseen.
function sweep(k: ReturnType<typeof kit>, material: THREE.Material, width: number, start: number, radius: number, height: number) {
  const profile: [number, number][] = [[start, 0]];
  for (let s = 1; s <= 14; s++) {
    const a = (s / 14) * (Math.PI / 2);
    profile.push([start + Math.sin(a) * radius, radius - Math.cos(a) * radius]);
  }
  profile.push([start + radius, height]);
  const positions: number[] = [];
  const index: number[] = [];
  profile.forEach(([z, y]) => positions.push(-width / 2, y, z, width / 2, y, z));
  for (let s = 0; s < profile.length - 1; s++) {
    const a = s * 2;
    // Wound so its faces look back into the room.
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = k.keep(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.003;
  mesh.receiveShadow = true;
  k.group.add(mesh);
}

// A big softbox on a stand, angled in at the canvas: its glowing face, and a wide soft spot from it.
function softbox(k: ReturnType<typeof kit>, at: THREE.Vector3, face: THREE.Material, body: THREE.Material, intensity: number, shadow: boolean) {
  const box = new THREE.Group();
  const shell = new THREE.Mesh(k.keep(new THREE.BoxGeometry(1.2, 1.5, 0.3)), body);
  const glow = new THREE.Mesh(k.keep(new THREE.PlaneGeometry(1.1, 1.4)), face);
  glow.position.z = 0.155;
  box.add(shell, glow);
  box.position.copy(at);
  box.lookAt(0, 0.4, 0);
  shell.castShadow = true;
  k.group.add(box);
  // The pole stands on a tripod: three legs from a collar partway up, splayed out and down to feet on the floor.
  const COLLAR = 0.45;
  const SPLAY = 0.4;
  const stand = new THREE.Mesh(k.keep(new THREE.CylinderGeometry(0.018, 0.018, at.y - COLLAR + 0.05, 8).translate(0, (at.y - COLLAR + 0.05) / 2, 0)), body);
  stand.position.set(at.x, COLLAR - 0.05, at.z);
  stand.castShadow = true;
  k.group.add(stand);
  const legGeometry = k.keep(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0));
  const up = new THREE.Vector3(0, 1, 0);
  for (let n = 0; n < 3; n++) {
    const a = (n / 3) * Math.PI * 2 + 0.4;
    const foot = new THREE.Vector3(at.x + Math.cos(a) * SPLAY, 0, at.z + Math.sin(a) * SPLAY);
    const toCollar = new THREE.Vector3(at.x, COLLAR, at.z).sub(foot);
    const leg = new THREE.Mesh(legGeometry, body);
    leg.position.copy(foot);
    leg.quaternion.setFromUnitVectors(up, toCollar.clone().normalize());
    leg.scale.set(1, toCollar.length(), 1);
    leg.castShadow = true;
    k.group.add(leg);
  }
  const light = new THREE.SpotLight("#fffaf2", intensity, 0, THREE.MathUtils.degToRad(62), 1, 2);
  light.position.copy(at);
  light.target.position.set(0, 0, 0);
  light.castShadow = shadow;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.radius = 16;
  light.shadow.bias = -0.0005;
  k.group.add(light, light.target);
}

// ——— The gallery: a white loft. A white painted floor covered in paint, white walls, a wall of tall windows with soft
// daylight falling in across the floor, and the cyclorama with its softboxes round the canvas. ———
export function Gallery() {
  const [concrete] = useLoader(THREE.TextureLoader, [`${ROOT}/concrete_floor_worn_001_diff_2k.jpg`]);
  const parts = useMemo(() => {
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    const k = kit();
    const floorMaterial = k.mat(new THREE.MeshStandardNodeMaterial({ metalness: 0 }));
    const spill = spillOn(k, 4096, 2207, VIVID);
    // White floor paint over concrete: the concrete's grain shows faintly through, scuffed greyer where it is walked.
    const grain = texture(concrete, positionWorld.xz.div(2.5)).g.mul(0.18).add(0.86) as any;
    const scuff = mx_noise_float(positionWorld.mul(vec3(0.6, 0, 0.6))).mul(0.04) as any;
    const white = color("#efece6").mul(grain).sub(scuff) as any;
    floorMaterial.colorNode = mix(white, spill.rgb, spill.a.mul(0.95)).mul(underCanvas(positionWorld)) as any;
    floorMaterial.roughnessNode = mix(float(0.62), float(0.3), spill.a) as any;
    const walls = plaster(k, "#ecebe7", "#f6f4ef");
    const ceiling = plaster(k, "#f2f1ee", "#f7f6f3");
    const glass = daylight(k, "#eaf2ff", "#fbf6ee", 2.4);
    const bars = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.4 }));
    bars.colorNode = color("#2a2b2d") as any;
    shell(k, ROOM, floorMaterial, walls, ceiling, { wall: "left", ...WINDOWS, glass, bars });
    // Soft daylight: the sky's fill does most of it, the sun through the windows draws them across the floor.
    k.group.add(new THREE.HemisphereLight("#f4f2ee", "#d6cdbf", 1.5));
    sun(k, "#fff1dc", 2.3, SUN, 9);
    // The cyclorama behind the canvas, its paint fading out as it rises off the floor.
    const cyc = k.mat(new THREE.MeshStandardNodeMaterial({ metalness: 0 }));
    const low = float(1).sub(smoothstep(0.0, 0.35, positionWorld.y)) as any;
    cyc.colorNode = mix(white, spill.rgb, spill.a.mul(0.95).mul(low)) as any;
    cyc.roughnessNode = mix(float(0.75), float(0.3), spill.a.mul(low)) as any;
    sweep(k, cyc, 6.4, 2.0, 1.4, 3.1);
    // Two softboxes either side of the canvas, filling it from the front.
    const face = daylight(k, "#ffffff", "#f7f4ee", 3.0);
    const body = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.6 }));
    body.colorNode = color("#1b1b1c") as any;
    softbox(k, new THREE.Vector3(2.5, 2.0, 0.9), face, body, 12, true);
    softbox(k, new THREE.Vector3(-2.3, 2.0, 1.3), face, body, 9, false);
    const wood = k.mat(new THREE.MeshStandardNodeMaterial({ roughness: 0.7 }));
    wood.colorNode = color("#c9b293") as any;
    table(k, [2.6, 0, -3.9], 0, wood, 41);
    leaning(k, [[4.3, 0.6, -Math.PI / 2, 1.3, 0.1], [4.25, 0.8, -Math.PI / 2, 1.0, 0.12], [4.3, 2.4, -Math.PI / 2, 1.5, 0.09], [-1.4, -4.3, 0, 1.1, 0.12], [-0.3, -4.32, 0, 0.8, 0.14]], 520);
    return k;
  }, [concrete]);
  useDispose(...parts.geometries, ...parts.materials, ...parts.textures);
  return <primitive object={parts.group} />;
}
