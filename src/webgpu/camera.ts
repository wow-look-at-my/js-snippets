// Orbit + first-person look cameras.

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

/*Handy for a sun/light direction: `[cosEl*sinAz, sinEl, cosEl*cosAz]`. */
export function dirFromAzEl(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  return [ce * Math.sin(azimuth), se, ce * Math.cos(azimuth)];
}

/** Options for `createOrbitController`. */
export interface OrbitControllerOptions {
  /* */
  azimuth?: number;
  /* */
  elevation?: number;
  /* */
  distance?: number;
  /* */
  target?: Vec3;
  /* */
  rotateSpeed?: number;
  /* */
  minDistance?: number;
  maxDistance?: number;
  /* */
  minElevation?: number;
  maxElevation?: number;
  /* */
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

/** First-person look camera state, in degrees (see `applyLookDrag`). */
export interface LookState {
  /* */
  azDeg: number;
  /** Pitch in degrees above the horizon (positive = looking up), clamped. */
  elDeg: number;
}

/** Options for `applyLookDrag` (and inherited by `createLookController`). */
export interface LookDragOptions {
  /* */
  sensDegPerPx?: number;
  /** Flip the pitch axis: pointer up = look DOWN, flight-sim style (default false). */
  invertY?: boolean;
  /* */
  minElDeg?: number;
  maxElDeg?: number;
}

/* */
function wrapAzDeg(a: number): number {
  const w = ((a % 360) + 360) % 360;
  return w > 180 ? w - 360 : w;
}

/** Advance a first-person look camera by a pointer drag of `(dxPx, dyPx)` CSS
 * pixels. Returns a NEW state; the input is not mutated. */
export function applyLookDrag(
  state: LookState,
  dxPx: number,
  dyPx: number,
  opts: LookDragOptions = {},
): LookState {
  const {
    sensDegPerPx = 0.25,
    invertY = false,
    minElDeg = -89,
    maxElDeg = 89,
  } = opts;
  const azDeg = wrapAzDeg(state.azDeg - dxPx * sensDegPerPx);
  const dEl = (invertY ? dyPx : -dyPx) * sensDegPerPx;
  const elDeg = Math.min(maxElDeg, Math.max(minElDeg, state.elDeg + dEl));
  return { azDeg, elDeg };
}

/** Options for `createLookController`. */
export interface LookControllerOptions extends LookDragOptions {
  /* */
  azDeg?: number;
  /* */
  elDeg?: number;
  /** Called with the new state after every drag update. */
  onChange?: (state: LookState) => void;
}

/** A live first-person look camera bound to an element. */
export interface LookController {
  azDeg: number;
  elDeg: number;
  /** Current unit view direction from the live az/el (degrees -> radians -> `dirFromAzEl`). */
  dir(): Vec3;
  /** View matrix from `eye` toward `eye + dir()`. */
  viewMatrix(eye: Vec3, up?: Vec3): Mat4;
  /** Remove the pointer listeners. */
  dispose(): void;
}

/**
 * Attach drag-to-look controls to `element` (a first-person camera at a fixed
 * eye). Returns a live controller whose `azDeg`/`elDeg` are read each frame
 * (and may be set directly). Drags feed through `applyLookDrag`, so the
 * convention documented there holds: pointer right = look right, pointer up =
 * look up (`invertY` flips), elevation clamped, azimuth wrapped.
 */
export function createLookController(
  element: HTMLElement,
  options: LookControllerOptions = {},
): LookController {
  const { azDeg = 0, elDeg = 0, onChange, ...dragOpts } = options;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    element.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const next = applyLookDrag(
      { azDeg: controller.azDeg, elDeg: controller.elDeg },
      e.clientX - lastX,
      e.clientY - lastY,
      dragOpts,
    );
    controller.azDeg = next.azDeg;
    controller.elDeg = next.elDeg;
    lastX = e.clientX;
    lastY = e.clientY;
    onChange?.(next);
  };
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    element.releasePointerCapture?.(e.pointerId);
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);

  const DEG = Math.PI / 180;
  const controller: LookController = {
    azDeg,
    elDeg,
    dir() {
      return dirFromAzEl(this.azDeg * DEG, this.elDeg * DEG);
    },
    viewMatrix(eye: Vec3, up: Vec3 = [0, 1, 0]) {
      const d = this.dir();
      return lookAt(eye, [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]], up);
    },
    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
    },
  };

  return controller;
}
