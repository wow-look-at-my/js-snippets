// First-person fly ("noclip") camera: the look half comes from `applyLookDrag` in camera.ts (drag-to-look, pointer-up = look-up).

import { applyLookDrag, dirFromAzEl } from './camera.ts';
import type { LookDragOptions, LookState } from './camera.ts';
import { lookAt } from '../math/mat4.ts';
import type { Mat4 } from '../math/mat4.ts';
import { add, cross, normalize, scale } from '../math/vec3.ts';
import type { Vec3 } from '../math/vec3.ts';

/** Which movement keys are currently held. */
export interface FlyMoveState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

const DEG = Math.PI / 180;

/** Displacement for one movement step of length `distance` (pure).
 *
 * - `forward`/`back` move along the full 3D view direction
 *   (`dirFromAzEl(look)`) — pitching down and holding forward flies into the
 *   ground, noclip style.
 * - `left`/`right` strafe along `normalize(cross(dir, up))` (screen-right; see
 *   the camera.ts drag-convention note).
 * - `up`/`down` move along the world `up` axis (default `[0,1,0]`), NOT the
 *   camera's tilted up vector. */
export function flyMoveDelta(
  look: LookState,
  move: FlyMoveState,
  distance: number,
  up: Vec3 = [0, 1, 0],
): Vec3 {
  const dir = dirFromAzEl(look.azDeg * DEG, look.elDeg * DEG);
  const right = normalize(cross(dir, up));
  let out: Vec3 = [0, 0, 0];
  const fwd = (move.forward ? 1 : 0) - (move.back ? 1 : 0);
  const side = (move.right ? 1 : 0) - (move.left ? 1 : 0);
  const vert = (move.up ? 1 : 0) - (move.down ? 1 : 0);
  if (fwd) out = add(out, scale(dir, fwd * distance));
  if (side) out = add(out, scale(right, side * distance));
  if (vert) out = add(out, scale(up, vert * distance));
  return out;
}

/** Displacement for a dolly of `amount` world units along the view direction
 * (pure). Positive = toward what you're looking at. */
export function dollyDelta(look: LookState, amount: number): Vec3 {
  return scale(dirFromAzEl(look.azDeg * DEG, look.elDeg * DEG), amount);
}

/** Options for `createFlyController`. */
export interface FlyControllerOptions extends LookDragOptions {
  /* */
  position?: Vec3;
  /* */
  azDeg?: number;
  /* */
  elDeg?: number;
  /* */
  moveSpeed?: number;
  /* */
  wheelSpeed?: number;
  /* */
  pinchSpeed?: number;
  /* */
  up?: Vec3;
  /** `KeyboardEvent.code` → movement mapping (default WASD + Space/E up, Q down). */
  keyMap?: Record<string, keyof FlyMoveState>;
  /* */
  dragButtons?: number[];
}

/** A live fly camera bound to an element. */
export interface FlyController {
  position: Vec3;
  azDeg: number;
  elDeg: number;
  /** Current unit view direction. */
  dir(): Vec3;
  /** Advance key-held movement by `dt` seconds. Call once per frame. */
  update(dt: number): void;
  /** View matrix from `position` toward `position + dir()`. */
  viewMatrix(): Mat4;
  /** Remove every listener. */
  dispose(): void;
}

const DEFAULT_KEY_MAP: Record<string, keyof FlyMoveState> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'up',
  KeyE: 'up',
  KeyQ: 'down',
};

/*Read/set `position`/`azDeg`/`elDeg` directly at any time. */
export function createFlyController(
  element: HTMLElement,
  options: FlyControllerOptions = {},
): FlyController {
  const {
    position = [0, 0, 0] as Vec3,
    azDeg = 0,
    elDeg = 0,
    moveSpeed = 5,
    wheelSpeed = 0.01,
    pinchSpeed = 0.08,
    up = [0, 1, 0] as Vec3,
    keyMap = DEFAULT_KEY_MAP,
    dragButtons = [0, 2],
    ...dragOpts
  } = options;

  const move: FlyMoveState = { forward: false, back: false, left: false, right: false, up: false, down: false };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastPinchDist = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (!dragButtons.includes(e.button)) return;
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
  };
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    element.releasePointerCapture?.(e.pointerId);
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  const onKey = (e: KeyboardEvent) => {
    const prop = keyMap[e.code];
    if (prop) move[prop] = e.type === 'keydown';
  };

  // Losing window focus swallows the matching keyup.
  const onWindowBlur = () => {
    for (const k of Object.keys(move) as (keyof FlyMoveState)[]) move[k] = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight || 800 : 1;
    controller.position = add(
      controller.position,
      dollyDelta({ azDeg: controller.azDeg, elDeg: controller.elDeg }, -e.deltaY * unit * wheelSpeed),
    );
  };

  const pinchDist = (e: TouchEvent) =>
    Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) lastPinchDist = pinchDist(e);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const dist = pinchDist(e);
    const delta = dist - lastPinchDist;
    lastPinchDist = dist;
    controller.position = add(
      controller.position,
      dollyDelta({ azDeg: controller.azDeg, elDeg: controller.elDeg }, delta * pinchSpeed),
    );
  };

  const doc = element.ownerDocument;
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  if (dragButtons.includes(2)) element.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('keyup', onKey);
  doc.defaultView?.addEventListener('blur', onWindowBlur);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchmove', onTouchMove, { passive: true });

  const controller: FlyController = {
    position,
    azDeg,
    elDeg,
    dir() {
      return dirFromAzEl(this.azDeg * DEG, this.elDeg * DEG);
    },
    update(dt: number) {
      this.position = add(
        this.position,
        flyMoveDelta({ azDeg: this.azDeg, elDeg: this.elDeg }, move, moveSpeed * dt, up),
      );
    },
    viewMatrix() {
      const d = this.dir();
      return lookAt(this.position, add(this.position, d), up);
    },
    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      if (dragButtons.includes(2)) element.removeEventListener('contextmenu', onContextMenu);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('keyup', onKey);
      doc.defaultView?.removeEventListener('blur', onWindowBlur);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
    },
  };

  return controller;
}
