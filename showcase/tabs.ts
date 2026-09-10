/**
 * Tab routing for the gallery: exactly ONE section is visible, the one
 * whose id matches the location hash (the first section when the hash
 * names nothing). The TOC links are the tabs. Sections stay in the DOM,
 * so every demo keeps running and switching back costs nothing. The
 * components skip drawing while hidden (IntersectionObserver) and catch up
 * on their first visible frame.
 */
export function installTabs(): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('main > section'));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav.toc a'));
  if (sections.length === 0) return;
  const show = (): void => {
    const want = location.hash.replace(/^#/, '');
    const target = sections.find((s) => s.id === want) ?? sections[0];
    for (const s of sections) s.hidden = s !== target;
    for (const a of links) {
      const active = a.getAttribute('href') === `#${target.id}`;
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  window.addEventListener('hashchange', show);
  show();
}
