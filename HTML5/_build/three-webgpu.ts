// three/webgpu, with one change for a phone running a day in its lighter mode: the "physical" material (clearcoat,
// transmission and the rest) is swapped for the standard one, whose shaders are a fraction of the size. The Galaxy S23's
// driver has taken the page's graphics down while compiling the big ones.
// Clearcoat gloss becomes a lower roughness; glass that transmitted becomes see-through instead.
// @ts-nocheck
import * as T from "THREE_WEBGPU_REAL";
export * from "THREE_WEBGPU_REAL";

const Physical = T.MeshPhysicalNodeMaterial;
const Standard = T.MeshStandardNodeMaterial;

class LightPhysical extends Standard {
  constructor(parameters = {}) {
    const { clearcoat, clearcoatRoughness, transmission, thickness, ior, sheen, sheenRoughness, sheenColor, iridescence, iridescenceIOR, iridescenceThicknessRange, attenuationColor, attenuationDistance, specularIntensity, specularColor, dispersion, anisotropy, ...rest } = parameters;
    super(rest);
    this.isMeshPhysicalNodeMaterial = true;
    if (clearcoat && rest.roughness !== undefined) this.roughness = Math.min(rest.roughness, 0.18);
    if (transmission && transmission > 0) {
      this.transparent = true;
      this.opacity = Math.max(0.25, 1 - transmission * 0.7);
      this.depthWrite = false;
    }
  }
}

export const MeshPhysicalNodeMaterial = new Proxy(Physical, {
  construct(target, args, newTarget) {
    return globalThis.__cvLite ? new LightPhysical(...args) : Reflect.construct(target, args, newTarget);
  }
});
