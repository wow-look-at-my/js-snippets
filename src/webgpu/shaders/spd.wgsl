// AMD Single Pass Downsampler — adapted for WebGPU
//
// Phase 1 (downsample): each workgroup covers a 64x64 source tile, generates
//   mips 1-6 via shared memory reductions, writes to a flat storage buffer.
// Phase 2 (downsampleTail): one workgroup reads mip 6 from the buffer and
//   generates remaining mips 7+.
//
// After both dispatches, the caller copies each mip from the buffer to the
// texture with copyBufferToTexture.

struct MipInfo {
	bufOffset: u32,   // offset in vec4 units into output buffer
	padWidth: u32,    // row stride in pixels (padded for 256-byte copy alignment)
	width: u32,
	height: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> buf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> mips: array<MipInfo>;
@group(0) @binding(3) var<uniform> params: vec4<u32>; // x=numWgX, y=numWgY, z=mipCount

var<workgroup> sd: array<vec4<f32>, 1024>; // 32x32 shared memory (16 KB)

fn loadSrc(x: i32, y: i32) -> vec4<f32> {
	let dims = vec2<i32>(textureDimensions(src, 0));
	return textureLoad(src, clamp(vec2(x, y), vec2(0), dims - 1), 0);
}

fn avg4(a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>) -> vec4<f32> {
	return (a + b + c + d) * 0.25;
}

fn writeMip(level: u32, x: u32, y: u32, val: vec4<f32>) {
	let m = mips[level];
	if x < m.width && y < m.height {
		buf[m.bufOffset + y * m.padWidth + x] = val;
	}
}

fn readMip(level: u32, x: u32, y: u32) -> vec4<f32> {
	let m = mips[level];
	return buf[m.bufOffset + clamp(y, 0u, m.height - 1u) * m.padWidth + clamp(x, 0u, m.width - 1u)];
}

// ── Phase 1 ─────────────────────────────────────────────────────────────────

@compute @workgroup_size(256)
fn downsample(
	@builtin(local_invocation_index) tid: u32,
	@builtin(workgroup_id) wid: vec3<u32>,
) {
	let wx = wid.x;
	let wy = wid.y;

	// Step 1: load 64x64, reduce to 32x32 → shared + mip 1
	// 256 threads × 4 quads = 1024 output pixels
	for (var q = 0u; q < 4u; q++) {
		let lx = (tid % 16u) + (q % 2u) * 16u;
		let ly = (tid / 16u) + (q / 2u) * 16u;
		let sx = i32(wx * 64u + lx * 2u);
		let sy = i32(wy * 64u + ly * 2u);
		let val = avg4(loadSrc(sx, sy), loadSrc(sx + 1, sy),
		               loadSrc(sx, sy + 1), loadSrc(sx + 1, sy + 1));
		sd[ly * 32u + lx] = val;
		writeMip(0u, wx * 32u + lx, wy * 32u + ly, val);
	}

	// Step 2: 32x32 → 16x16 → mip 2 (all 256 threads active)
	workgroupBarrier();
	var v2: vec4<f32>;
	{
		let lx = tid % 16u;
		let ly = tid / 16u;
		v2 = avg4(sd[(ly * 2u) * 32u + lx * 2u],     sd[(ly * 2u) * 32u + lx * 2u + 1u],
		          sd[(ly * 2u + 1u) * 32u + lx * 2u], sd[(ly * 2u + 1u) * 32u + lx * 2u + 1u]);
	}
	workgroupBarrier();
	{
		let lx = tid % 16u;
		let ly = tid / 16u;
		sd[ly * 16u + lx] = v2;
		writeMip(1u, wx * 16u + lx, wy * 16u + ly, v2);
	}

	// Step 3: 16x16 → 8x8 → mip 3 (64 threads)
	workgroupBarrier();
	var v3: vec4<f32>;
	if tid < 64u {
		let lx = tid % 8u;
		let ly = tid / 8u;
		v3 = avg4(sd[(ly * 2u) * 16u + lx * 2u],     sd[(ly * 2u) * 16u + lx * 2u + 1u],
		          sd[(ly * 2u + 1u) * 16u + lx * 2u], sd[(ly * 2u + 1u) * 16u + lx * 2u + 1u]);
	}
	workgroupBarrier();
	if tid < 64u {
		let lx = tid % 8u;
		let ly = tid / 8u;
		sd[ly * 8u + lx] = v3;
		writeMip(2u, wx * 8u + lx, wy * 8u + ly, v3);
	}

	// Step 4: 8x8 → 4x4 → mip 4 (16 threads)
	workgroupBarrier();
	var v4: vec4<f32>;
	if tid < 16u {
		let lx = tid % 4u;
		let ly = tid / 4u;
		v4 = avg4(sd[(ly * 2u) * 8u + lx * 2u],     sd[(ly * 2u) * 8u + lx * 2u + 1u],
		          sd[(ly * 2u + 1u) * 8u + lx * 2u], sd[(ly * 2u + 1u) * 8u + lx * 2u + 1u]);
	}
	workgroupBarrier();
	if tid < 16u {
		let lx = tid % 4u;
		let ly = tid / 4u;
		sd[ly * 4u + lx] = v4;
		writeMip(3u, wx * 4u + lx, wy * 4u + ly, v4);
	}

	// Step 5: 4x4 → 2x2 → mip 5 (4 threads)
	workgroupBarrier();
	var v5: vec4<f32>;
	if tid < 4u {
		let lx = tid % 2u;
		let ly = tid / 2u;
		v5 = avg4(sd[(ly * 2u) * 4u + lx * 2u],     sd[(ly * 2u) * 4u + lx * 2u + 1u],
		          sd[(ly * 2u + 1u) * 4u + lx * 2u], sd[(ly * 2u + 1u) * 4u + lx * 2u + 1u]);
	}
	workgroupBarrier();
	if tid < 4u {
		let lx = tid % 2u;
		let ly = tid / 2u;
		sd[ly * 2u + lx] = v5;
		writeMip(4u, wx * 2u + lx, wy * 2u + ly, v5);
	}

	// Step 6: 2x2 → 1x1 → mip 6
	workgroupBarrier();
	if tid == 0u {
		writeMip(5u, wx, wy, avg4(sd[0], sd[1], sd[2], sd[3]));
	}
}

// ── Phase 2: remaining mips from mip 6 onward ──────────────────────────────

@compute @workgroup_size(256)
fn downsampleTail(@builtin(local_invocation_index) tid: u32) {
	let totalMips = params.z; // includes mip 0 (source)

	for (var m = 6u; m < totalMips - 1u; m++) {
		let prev = mips[m - 1u];
		let cur = mips[m];
		let count = cur.width * cur.height;
		if tid < count {
			let x = tid % cur.width;
			let y = tid / cur.width;
			let val = avg4(
				readMip(m - 1u, x * 2u, y * 2u),
				readMip(m - 1u, x * 2u + 1u, y * 2u),
				readMip(m - 1u, x * 2u, y * 2u + 1u),
				readMip(m - 1u, x * 2u + 1u, y * 2u + 1u));
			writeMip(m, x, y, val);
		}
		storageBarrier();
	}
}
