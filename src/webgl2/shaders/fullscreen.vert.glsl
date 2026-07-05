#version 300 es
// Fullscreen triangle from gl_VertexID — no vertex buffer needed.
// Vertices 0/1/2 → clip (-1,-1) (3,-1) (-1,3); vUv spans [0,1]² on screen
// with v=0 at the bottom (clip y=-1).
out vec2 vUv;

void main() {
	vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	vUv = corner;
	gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
