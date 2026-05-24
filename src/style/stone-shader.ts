import * as THREE from 'three';

// Procedural stone shader injected into MeshStandardMaterial via onBeforeCompile.
// Generates a noise-modulated base color with a "mortar grid" overlay so the
// surface reads as irregular masonry rather than flat color. No asset files.
//
// The shader runs as a multiplier on diffuseColor before the lighting pass,
// so the dungeon's torchlight + fog still does its work on top — we're just
// painting a stone pattern over the wall, not replacing the lighting model.

interface StoneOptions {
  scale: number;      // higher = smaller stones
  mortarColor: number;
  baseColor: number;
}

export function applyStoneShader(material: THREE.MeshStandardMaterial, opts: StoneOptions) {
  const mortar = new THREE.Color(opts.mortarColor);
  const base = new THREE.Color(opts.baseColor);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStoneScale = { value: opts.scale };
    shader.uniforms.uMortarColor = { value: mortar };
    shader.uniforms.uBaseColor = { value: base };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>

        uniform float uStoneScale;
        uniform vec3 uMortarColor;
        uniform vec3 uBaseColor;

        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // 2D value noise
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        // Multi-octave fbm for stone grain
        float stoneGrain(vec2 uv) {
          float v = 0.0;
          float amp = 0.55;
          for (int i = 0; i < 4; i++) {
            v += vnoise(uv) * amp;
            uv *= 2.07;
            amp *= 0.5;
          }
          return v;
        }
        `,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
        vec2 sUv = vUv * uStoneScale;
        // Per-stone offset so blocks don't all look identical
        vec2 cellId = floor(sUv);
        vec2 cellLocal = fract(sUv);
        float cellNoise = hash21(cellId);

        // Mortar lines — darker bands at cell edges, slightly thicker on horizontal
        vec2 edgeDist = abs(cellLocal - 0.5);
        float mortarLine = smoothstep(0.42, 0.48, max(edgeDist.x, edgeDist.y * 0.95));

        // Stone grain inside each cell — sample fbm with cell-id offset for variety
        float grain = stoneGrain(sUv + cellNoise * 7.13);
        vec3 stone = uBaseColor * (0.55 + grain * 0.9);

        // Vary cell brightness slightly so neighboring stones aren't identical
        stone *= 0.78 + cellNoise * 0.45;

        vec3 finalCol = mix(stone, uMortarColor, mortarLine);

        vec4 diffuseColor = vec4(finalCol, opacity);
        `,
      );
  };

  // Force material recompile if it was already compiled
  material.needsUpdate = true;
}
