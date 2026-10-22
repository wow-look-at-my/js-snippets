/** Tell a component when a page first listens for one of its events. */

/**
 * Call `onFirst` one time, when the first listener for `type` is added to
 * `target`. A component uses it to turn on a behavior that only makes sense
 * with a listener, such as rows a keyboard can reach. A listener added before
 * this call is not seen.
 */
export function onFirstListener(target: EventTarget, type: string, onFirst: () => void): void {
  const add = target.addEventListener.bind(target);
  let seen = false;
  target.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void => {
    add(kind, listener, options);
    if (kind !== type || listener === null || seen) return;
    seen = true;
    onFirst();
  };
}
