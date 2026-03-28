// IBL environment map prefilter — GGX importance sampling.
//
// Each mip level is convolved with a GGX distribution at a roughness
// proportional to the mip level. Mip 0 copies the source; higher mips
// get increasingly blurred according to the specular lobe.
//
// Dispatched once per output mip level. The caller sets roughness and
// output dimensions via the uniform.

const PI: f32 = 3.14159265359;

struct Params {
	width: u32,       // output mip width
	height: u32,      // output mip height
	padWidth: u32,    // row stride in pixels (padded for 256-byte alignment)
	bufOffset: u32,   // offset in vec4 units into output buffer
	roughness: f32,
	numSamples: u32,
	_pad0: u32,
	_pad1: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: Params;

// Van der Corput radical inverse (bit reversal)
fn radicalInverse(bits_in: u32) -> f32 {
	var bits = bits_in;
	bits = (bits << 16u) | (bits >> 16u);
	bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
	bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
	bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
	bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
	return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, N: u32) -> vec2<f32> {
	return vec2(f32(i) / f32(N), radicalInverse(i));
}

// GGX importance sampling — returns a half-vector in world space.
fn importanceSampleGGX(Xi: vec2<f32>, N: vec3<f32>, roughness: f32) -> vec3<f32> {
	let a = roughness * roughness;

	let phi = 2.0 * PI * Xi.x;
	let cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
	let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

	// Tangent-space half vector
	let H = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

	// Build tangent frame from N
	let up = select(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), abs(N.z) < 0.999);
	let T = normalize(cross(up, N));
	let B = cross(N, T);

	return normalize(T * H.x + B * H.y + N * H.z);
}

// Equirectangular UV from direction
fn dirToUV(dir: vec3<f32>) -> vec2<f32> {
	let u = atan2(dir.z, dir.x) / (2.0 * PI) + 0.5;
	let v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
	return vec2(u, v);
}

// Direction from equirectangular UV
fn uvToDir(uv: vec2<f32>) -> vec3<f32> {
	let phi = (uv.x - 0.5) * 2.0 * PI;
	let theta = uv.y * PI;
	let sinTheta = sin(theta);
	return vec3(cos(phi) * sinTheta, cos(theta), sin(phi) * sinTheta);
}

@compute @workgroup_size(8, 8)
fn prefilter(@builtin(global_invocation_id) gid: vec3<u32>) {
	if gid.x >= params.width || gid.y >= params.height { return; }

	let uv = vec2(
		(f32(gid.x) + 0.5) / f32(params.width),
		(f32(gid.y) + 0.5) / f32(params.height),
	);
	let N = uvToDir(uv);
	let V = N; // split-sum approximation

	let roughness = params.roughness;
	let numSamples = params.numSamples;

	var color = vec3(0.0);
	var weight = 0.0;

	// Roughness 0: just copy the source texel
	if roughness < 0.001 {
		color = textureSampleLevel(src, srcSampler, uv, 0.0).rgb;
		weight = 1.0;
	} else {
		for (var i = 0u; i < numSamples; i++) {
			let Xi = hammersley(i, numSamples);
			let H = importanceSampleGGX(Xi, N, roughness);
			let L = normalize(2.0 * dot(V, H) * H - V);
			let NdotL = max(dot(N, L), 0.0);

			if NdotL > 0.0 {
				color += textureSampleLevel(src, srcSampler, dirToUV(L), 0.0).rgb * NdotL;
				weight += NdotL;
			}
		}
	}

	if weight > 0.0 {
		color /= weight;
	}

	let idx = params.bufOffset + gid.y * params.padWidth + gid.x;
	output[idx] = vec4(color, 1.0);
}
