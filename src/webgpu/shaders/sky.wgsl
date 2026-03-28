// Equirectangular HDRI sky — fullscreen triangle, no vertex buffer needed.

struct SkyUniforms {
	invViewProj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: SkyUniforms;
@group(0) @binding(1) var hdriTex: texture_2d<f32>;
@group(0) @binding(2) var hdriSampler: sampler;

struct VsOut {
	@builtin(position) pos: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

@vertex fn vsMain(@builtin(vertex_index) vi: u32) -> VsOut {
	var out: VsOut;
	let x = f32(i32(vi & 1u) * 4 - 1);
	let y = f32(i32(vi >> 1u) * 4 - 1);
	out.pos = vec4(x, y, 1.0, 1.0);
	out.uv = vec2(x, y);
	return out;
}

const PI: f32 = 3.14159265359;

@fragment fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
	let clip = vec4(in.uv.x, in.uv.y, 1.0, 1.0);
	let world = uniforms.invViewProj * clip;
	let dir = normalize(world.xyz / world.w);

	let u = atan2(dir.z, dir.x) / (2.0 * PI) + 0.5;
	let v = acos(clamp(dir.y, -1.0, 1.0)) / PI;

	let color = textureSample(hdriTex, hdriSampler, vec2(u, v)).rgb;

	// Reinhard tonemap
	let mapped = color / (color + vec3(1.0));
	return vec4(mapped, 1.0);
}
