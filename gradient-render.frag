// Gradient color renderer
// Reads the accumulated distance-field textures and blends colors.
// For each pixel: color = weighted blend of all group colors by inverse distance.
// Supports up to MAX_GROUPS groups spread across ceil(MAX_GROUPS/4) textures.

precision highp float;
varying vec2 vTexCoord;

#define MAX_GROUPS  30
#define MAX_TEXTURES 8   // ceil(30/4)
#define GRAIN_STEPS 8.0

uniform sampler2D u_dist[MAX_TEXTURES]; // distance-field textures
uniform vec3  u_colors[MAX_GROUPS];     // RGB color per group
uniform int   u_groupCount;             // active group count
uniform bool  u_grain;                  // grain overlay toggle
uniform float u_grainAmount;            // 0..1
uniform float u_opacity;                // layer opacity

// Pseudo-random hash for grain
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Get distance for group i from packed textures
float getDist(int i, vec2 uv) {
  int texIdx  = i / 4;
  int channel = int(mod(float(i), 4.0));
  vec4 texel = vec4(9999.0);
  for (int t = 0; t < MAX_TEXTURES; t++) {
    if (t == texIdx) { texel = texture2D(u_dist[t], uv); break; }
  }
  if      (channel == 0) return texel.r;
  else if (channel == 1) return texel.g;
  else if (channel == 2) return texel.b;
  else                   return texel.a;
}

void main() {
  vec2 uv = vTexCoord;
  uv.y = 1.0 - uv.y;

  if (u_groupCount == 0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Inverse-distance weighted blend
  float totalWeight = 0.0;
  vec3  blendedColor = vec3(0.0);
  float sharpness = 4.0; // higher = harder edges between strokes

  for (int i = 0; i < MAX_GROUPS; i++) {
    if (i >= u_groupCount) break;
    float d = getDist(i, uv);
    // avoid division by zero; pixels directly on stroke get full weight
    float w = 1.0 / (pow(d * 300.0 + 0.001, sharpness));
    blendedColor += u_colors[i] * w;
    totalWeight  += w;
  }

  vec3 color = blendedColor / totalWeight;

  // Grain overlay
  if (u_grain && u_grainAmount > 0.0) {
    float g = hash12(uv * 1000.0) * u_grainAmount - (u_grainAmount * 0.5);
    color += g;
  }

  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color, u_opacity);
}
