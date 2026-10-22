/** Attach a component stylesheet to a shadow root. */

/**
 * Adopt `css` as a constructed stylesheet. An engine without constructed
 * stylesheets gets a <style> element appended to the root instead.
 */
export function adoptShadowStyles(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    root.append(style);
  }
}
