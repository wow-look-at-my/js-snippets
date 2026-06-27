// Orbit camera -- the spherical eye + drag-to-rotate + wheel-zoom controller that
// almost every 3D scratchpad reimplements. The pure helpers (`orbitEye`,
// `dirFromAzEl`) have no DOM dependency; `createOrbitController` wires pointer
// and wheel events onto a canvas.

import { lookAt } from '../math/mat4.ts';
import type { Vec3 } from '../math/vec3.ts';
import type { Mat4 } from '../math/mat4.ts';

/**
 * Spherical -> cartesian eye position for an orbit camera looking at `target`.
 * `azimuth` rotates around +Y, `elevation` lifts toward +Y (radians):
 * `eye = target + distance * [cosEl*sinAz, sinEl, cosEl*cosAz]`.
 */
export function orbitEye(target: Vec3, azimuth: number, elevation: number, distance: number): Vec3 {
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  return [
    target[0] + distance * ce * Math.sin(azimuth),
    target[1] + distance * se,
    target[2] + distance * ce * Math.cos(azimuth),
  ];
}

/**
 * Unit direction from azimuth/elevation (the `orbitEye` offset at distance 1,
 * relative to the target). Handy for a sun/light direction:
 * `[cosEl*sinAz, sinEl, cosEl*cosAz]`.
 */
export function dirFromAzEl(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  return [ce * Math.sin(azimuth), se, ce * Math.cos(azimuth)];
}

/** Options for `createOrbitController`. */
export interface OrbitControllerOptions {
  /** Initial azimuth in radians (default 0.7). */
  azimuth?: number;
  /** Initial elevation in radians (default 0.5). */
  elevation?: number;
  /** Initial distance from the target (default 6). */
  distance?: number;
  /** Look-at target (default [0, 0, 0]). */
  target?: Vec3;
  /** Radians of rotation per pixel dragged (default 0.006). */
  rotateSpeed?: number;
  /** Minimum / maximum zoom distance (defaults 0.1 / Infinity). */
  minDistance?: number;
  maxDistance?: number;
  /** Elevation clamp in radians (defaults 0.05 / 1.5). */
  minElevation?: number;
  maxElevation?: number;
  /** Wheel zoom strength; distance *= exp(deltaPixels * zoomSpeed) (default 0.0015). */
  zoomSpeed?: number;
}

/** A live orbit camera bound to a canvas. */
export interface OrbitController {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
  /** Current eye position from the live azimuth/elevation/distance. */
  eye(): Vec3;
  /** View matrix from the current eye toward the target. */
  viewMatrix(up?: Vec3): Mat4;
  /** Remove the pointer/wheel listeners. */
  dispose(): void;
}

/**
 * Attach drag-to-orbit + wheel-to-zoom controls to `canvas`. Returns a live
 * controller whose `azimuth`/`elevation`/`distance`/`target` are read each frame
 * (and may be set directly). Drag updates azimuth/elevation (clamped); the wheel
 * scales distance exponentially (clamped), normalising `deltaMode` line/page
 * units to pixels.
 */
export function createOrbitController(
  canvas: HTMLCanvasElement,
  options: OrbitControllerOptions = {},
): OrbitController {
  const {
    azimuth = 0.7,
    elevation = 0.5,
    distance = 6,
    target = [0, 0, 0] as Vec3,
    rotateSpeed = 0.006,
    minDistance = 0.1,
    maxDistance = Infinity,
    minElevation = 0.05,
    maxElevation = 1.5,
    zoomSpeed = 0.0015,
  } = options;

  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    controller.azimuth -= (e.clientX - lastX) * rotateSpeed;
    controller.elevation = clamp(controller.elevation + (e.clientY - lastY) * rotateSpeed, minElevation, maxElevation);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Normalise deltaMode: 0 = pixels, 1 = lines (~16px), 2 = pages (~viewport).
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight || 800 : 1;
    controller.distance = clamp(controller.distance * Math.exp(e.deltaY * unit * zoomSpeed), minDistance, maxDistance);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const controller: OrbitController = {
    azimuth,
    elevation,
    distance,
    target,
    eye() {
      return orbitEye(this.target, this.azimuth, this.elevation, this.distance);
    },
    viewMatrix(up: Vec3 = [0, 1, 0]) {
      return lookAt(this.eye(), this.target, up);
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
    },
  };

  return controller;
}
