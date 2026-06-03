// Distance-field data texture accumulator
// For each pixel: find minimum distance to each stroke group.
// R channel = distance to group 0, G = group 1, B = group 2 ... (packed 4 per texel)
// We store up to 30 groups across multiple textures but here we handle per-segment updates.
// Each draw call feeds ONE segment (ptA → ptB) for ONE groupId.
// The output accumulates into a framebuffer: min(prev, dist).

precision highp float;
varying vec2 vTexCoord;

uniform sampler2D u_prevState; // accumulated distances so far
uniform vec2 u_ptA;            // segment start (normalised 0..1)
uniform vec2 u_ptB;            // segment end   (normalised 0..1)
uniform float u_groupIndex;    // which group slot (0..29)
uniform vec2 u_res;            // canvas resolution in pixels

// Minimum distance from point p to line segment (a,b)
float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ap = p - a;
  float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(ap - ab * t);
}

void main() {
  vec2 uv = vTexCoord;
  // flip Y to match canvas coordinate system
  uv.y = 1.0 - uv.y;

  // Current pixel position in same normalised space as ptA/ptB
  float dist = distToSegment(uv, u_ptA, u_ptB);

  // Load previous accumulated state (4 groups per texel, each texel = one "slot page")
  // We use a single RGBA float texture where each channel holds one group's min-distance.
  // groupIndex 0..3 → channel r,g,b,a of texture page 0
  // groupIndex 4..7 → page 1, etc. We limit to one texture (4 groups) here for simplicity
  // and the main engine handles multiple textures for >4 groups.
  vec4 prev = texture2D(u_prevState, vTexCoord);

  // Determine which channel to update
  int slot = int(mod(u_groupIndex, 4.0));
  vec4 out_dist = prev;
  if      (slot == 0) out_dist.r = min(prev.r, dist);
  else if (slot == 1) out_dist.g = min(prev.g, dist);
  else if (slot == 2) out_dist.b = min(prev.b, dist);
  else                out_dist.a = min(prev.a, dist);

  gl_FragColor = out_dist;
}
