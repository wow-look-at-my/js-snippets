/**
 * Auto-Refresh Detection
 *
 * Periodically sends HEAD requests to the current page to detect server-side
 * changes via ETag / Last-Modified headers. When a change is detected, a
 * notification banner is shown and the page reloads automatically.
 *
 * Usage: <script type="module" src="auto-refresh.js"></script>
 */

// -- Configuration -----------------------------------------------------------

const DEFAULT_INTERVAL = 30_000; // ms between checks
const DEFAULT_REFRESH_DELAY = 2_000; // ms before reload after detection

// -- Cache-bust cleanup ------------------------------------------------------

// Strip the _v cache-busting param from the URL so it doesn't linger
{
  const url = new URL(location.href);
  if (url.searchParams.has('_v')) {
    url.searchParams.delete('_v');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}

// -- Types -------------------------------------------------------------------

export interface AutoRefreshOptions {
  /** Milliseconds between HEAD checks (default 30 000). */
  interval?: number;
  /** Milliseconds before reload after a change is detected (default 2 000). */
  refreshDelay?: number;
}

export interface AutoRefreshHandle {
  start(): void;
  stop(): void;
}

// -- Cache-bust helper -------------------------------------------------------

/** Navigate to the current page with a cache-busting `_v` query param. */
export function bustCacheAndReload(): void {
  const url = new URL(location.href);
  url.searchParams.set('_v', String(Date.now()));
  location.replace(url.href);
}

// -- Factory -----------------------------------------------------------------

export function createAutoRefresh(
  options: AutoRefreshOptions = {},
): AutoRefreshHandle {
  const checkInterval = options.interval ?? DEFAULT_INTERVAL;
  const refreshDelay = options.refreshDelay ?? DEFAULT_REFRESH_DELAY;

  let baseline: { etag: string | null; lastModified: string | null; contentLength: string | null } | null = null;
  let notified = false;
  let timerId: ReturnType<typeof setInterval> | null = null;

  // -- Helpers ---------------------------------------------------------------

  function pageUrl(): string {
    return location.href.split('#')[0];
  }

  function headersOf(response: Response) {
    return {
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentLength: response.headers.get('Content-Length'),
    };
  }

  function hasChanged(
    prev: NonNullable<typeof baseline>,
    curr: NonNullable<typeof baseline>,
  ): boolean {
    if (prev.etag && curr.etag) return prev.etag !== curr.etag;
    if (prev.lastModified && curr.lastModified)
      return prev.lastModified !== curr.lastModified;
    if (prev.contentLength && curr.contentLength)
      return prev.contentLength !== curr.contentLength;
    return false;
  }

  // -- Notification banner ---------------------------------------------------

  function showBanner(): void {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#2563eb;color:#fff;' +
      'padding:10px 16px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'font-size:14px;text-align:center;' +
      'transform:translateY(-100%);transition:transform 0.3s ease;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);';

    const msg = document.createElement('span');
    msg.textContent =
      'A newer version of this page is available. Refreshing\u2026';

    const btn = document.createElement('button');
    btn.textContent = 'Refresh now';
    btn.style.cssText =
      'margin-left:12px;padding:4px 12px;' +
      'border:1px solid rgba(255,255,255,0.5);border-radius:4px;' +
      'background:transparent;color:#fff;cursor:pointer;font-size:13px;';
    btn.addEventListener('click', () => bustCacheAndReload());

    el.appendChild(msg);
    el.appendChild(btn);
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.style.transform = 'translateY(0)';
    });
  }

  // -- Core check ------------------------------------------------------------

  async function check(): Promise<void> {
    if (notified) return;

    try {
      const response = await fetch(pageUrl(), { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) return;

      const current = headersOf(response);

      if (!baseline) {
        baseline = current;
        return;
      }

      if (hasChanged(baseline, current)) {
        notified = true;
        clearInterval(timerId!);
        showBanner();
        setTimeout(() => bustCacheAndReload(), refreshDelay);
      }
    } catch (err) {
      console.debug('auto-refresh check failed:', err);
    }
  }

  // -- Public API ------------------------------------------------------------

  function start(): void {
    check();
    timerId = setInterval(check, checkInterval);
  }

  function stop(): void {
    clearInterval(timerId!);
    timerId = null;
  }

  // Pause polling while the tab is hidden to save bandwidth
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
    } else if (!notified) {
      start();
    }
  });

  return { start, stop };
}

// -- Auto-start when loaded as a standalone script ---------------------------
// Pages can import { createAutoRefresh } for manual control, or simply load
// the module to get the default behaviour with no extra code.

const instance = createAutoRefresh();

if (document.readyState === 'complete') {
  instance.start();
} else {
  window.addEventListener('load', () => instance.start());
}
