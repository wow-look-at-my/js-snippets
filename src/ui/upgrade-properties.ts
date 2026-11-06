/** Custom-element property upgrade, derived from the class's own setters. */

/**
 * Re-assigns, through `proto`'s setters, every own property that shadows one.
 * A consumer can set a property before the element's module loads; that value
 * then sits on the instance and the setter never runs. The list comes from the
 * prototype, so a new setter is covered with no edit here. Setters run in
 * declaration order.
 */
export function upgradeProperties(el: object, proto: object): void {
  const target = el as Record<string, unknown>;
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
    if (!d.set || !Object.prototype.hasOwnProperty.call(el, name)) continue;
    const value = target[name];
    delete target[name];
    target[name] = value;
  }
}
