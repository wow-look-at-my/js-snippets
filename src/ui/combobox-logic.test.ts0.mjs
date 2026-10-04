// src/ui/combobox-logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/ui/combobox-logic.ts
function isBrokenDropdownUA(userAgent) {
  return /Tesla|QtCarBrowser/i.test(userAgent);
}
function hasForceParam(search) {
  return !!search && /[?&]combobox=force\b/.test(search);
}
function shouldEnable(opts2 = {}) {
  try {
    if (opts2.force) return true;
    if (globalThis.__JS_COMBOBOX_FORCE__) return true;
    const match = opts2.match ?? isBrokenDropdownUA;
    if (match(globalThis.navigator?.userAgent ?? "")) return true;
    try {
      if (globalThis.localStorage && localStorage.getItem("js-combobox") === "force") return true;
    } catch {
    }
    if (hasForceParam(globalThis.location?.search)) return true;
  } catch {
  }
  return false;
}
function optionText(opt) {
  return opt && (opt.textContent || opt.value) || "";
}
function firstEnabledIndex(options) {
  for (let i = 0; i < options.length; i++) if (!options[i].disabled) return i;
  return 0;
}
function lastEnabledIndex(options) {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
  return options.length - 1;
}
function stepActiveIndex(current, dir, options) {
  let i = current;
  for (let n = 0; n < options.length; n++) {
    i = (i + dir + options.length) % options.length;
    if (!options[i].disabled) break;
  }
  return i;
}
function typeAheadTarget(buffer, activeIndex, options) {
  const buf = buffer.toLowerCase();
  if (!buf) return -1;
  const startAt = buf.length === 1 ? activeIndex + 1 : activeIndex;
  for (let n = 0; n < options.length; n++) {
    const i = (startAt + n + options.length) % options.length;
    if (!options[i].disabled && options[i].text.toLowerCase().startsWith(buf)) return i;
  }
  return -1;
}
function computePopupPlacement(input) {
  const r = input.trigger;
  const vw = input.viewport.width;
  const vh = input.viewport.height;
  const minWidth = r.width;
  const maxWidth = Math.min(Math.max(r.width, 200), Math.max(vw - 16, 120));
  const spaceBelow = vh - r.bottom;
  const spaceAbove = r.top;
  const naturalHeight = input.popup.height || 0;
  const desired = Math.min(naturalHeight, 320);
  const openUp = spaceBelow < desired && spaceAbove > spaceBelow;
  let top;
  let maxHeight;
  if (openUp) {
    maxHeight = Math.max(80, Math.min(spaceAbove - 8, 320));
    const shown = Math.max(0, Math.min(naturalHeight, maxHeight, spaceAbove - 8));
    top = Math.max(4, r.top - 2 - shown);
  } else {
    maxHeight = Math.max(80, Math.min(spaceBelow - 8, 320));
    top = r.bottom + 2;
  }
  const width = Math.max(Math.min(input.popup.width || r.width, maxWidth), minWidth);
  let left = r.left;
  if (left + width > vw - 4) left = Math.max(4, vw - 4 - width);
  if (left < 4) left = 4;
  return { top, left, maxHeight, minWidth, maxWidth, openUp };
}

// src/ui/combobox-logic.test.ts
var TESLA_UA = "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/79.0.3945.130 Chrome/79.0.3945.130 Safari/537.36 Tesla/2020.16.2.1-e8b0f4a54b1f";
var QT_CAR_UA = "Mozilla/5.0 (X11; Linux) AppleWebKit/534.34 (KHTML, like Gecko) QtCarBrowser Safari/534.34";
var DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test("isBrokenDropdownUA matches Tesla and QtCarBrowser, not ordinary browsers", () => {
  assert.equal(isBrokenDropdownUA(TESLA_UA), true);
  assert.equal(isBrokenDropdownUA(QT_CAR_UA), true);
  assert.equal(isBrokenDropdownUA(DESKTOP_UA), false);
  assert.equal(isBrokenDropdownUA("tesla"), true);
  assert.equal(isBrokenDropdownUA(""), false);
});
test("hasForceParam accepts only a real combobox=force query param", () => {
  assert.equal(hasForceParam("?combobox=force"), true);
  assert.equal(hasForceParam("?x=1&combobox=force&y=2"), true);
  assert.equal(hasForceParam("?notcombobox=force"), false);
  assert.equal(hasForceParam("?combobox=forced"), false);
  assert.equal(hasForceParam("?combobox=off"), false);
  assert.equal(hasForceParam(""), false);
  assert.equal(hasForceParam(null), false);
  assert.equal(hasForceParam(void 0), false);
});
test("shouldEnable: force bypasses the gate; the default gate is off under node", () => {
  assert.equal(shouldEnable({ force: true }), true);
  assert.equal(shouldEnable(), false);
  assert.equal(shouldEnable({}), false);
});
test("shouldEnable: a custom match receives the UA string and decides", () => {
  let seen;
  assert.equal(
    shouldEnable({ match: (ua) => {
      seen = ua;
      return true;
    } }),
    true
  );
  assert.equal(typeof seen, "string");
  assert.equal(shouldEnable({ match: () => false }), false);
});
test("shouldEnable: the __JS_COMBOBOX_FORCE__ global overrides", () => {
  const g = globalThis;
  assert.equal(shouldEnable(), false);
  g.__JS_COMBOBOX_FORCE__ = true;
  try {
    assert.equal(shouldEnable(), true);
  } finally {
    delete g.__JS_COMBOBOX_FORCE__;
  }
  assert.equal(shouldEnable(), false);
});
test("optionText prefers textContent, falls back to value, never returns null", () => {
  assert.equal(optionText({ textContent: "Label", value: "v" }), "Label");
  assert.equal(optionText({ textContent: "", value: "v" }), "v");
  assert.equal(optionText({ textContent: null, value: "v" }), "v");
  assert.equal(optionText({ textContent: "", value: "" }), "");
  assert.equal(optionText(void 0), "");
  assert.equal(optionText(null), "");
});
var opts = (...disabled) => disabled.map((d) => ({ disabled: d }));
test("firstEnabledIndex / lastEnabledIndex skip disabled ends", () => {
  assert.equal(firstEnabledIndex(opts(false, false)), 0);
  assert.equal(lastEnabledIndex(opts(false, false)), 1);
  assert.equal(firstEnabledIndex(opts(true, false, true)), 1);
  assert.equal(lastEnabledIndex(opts(true, false, true)), 1);
  assert.equal(firstEnabledIndex(opts(true, true, false, false)), 2);
  assert.equal(lastEnabledIndex(opts(false, false, true, true)), 1);
});
test("firstEnabledIndex / lastEnabledIndex fall back on all-disabled and empty lists", () => {
  assert.equal(firstEnabledIndex(opts(true, true)), 0);
  assert.equal(lastEnabledIndex(opts(true, true)), 1);
  assert.equal(firstEnabledIndex([]), 0);
  assert.equal(lastEnabledIndex([]), -1);
});
test("stepActiveIndex steps and wraps in both directions", () => {
  const all = opts(false, false, false, false);
  assert.equal(stepActiveIndex(0, 1, all), 1);
  assert.equal(stepActiveIndex(3, 1, all), 0);
  assert.equal(stepActiveIndex(0, -1, all), 3);
  assert.equal(stepActiveIndex(2, -1, all), 1);
});
test("stepActiveIndex skips disabled options", () => {
  const mid = opts(false, true, false);
  assert.equal(stepActiveIndex(0, 1, mid), 2);
  assert.equal(stepActiveIndex(2, 1, mid), 0);
  assert.equal(stepActiveIndex(0, -1, mid), 2);
  assert.equal(stepActiveIndex(2, -1, mid), 0);
  const single = opts(true, false, true);
  assert.equal(stepActiveIndex(0, 1, single), 1);
  assert.equal(stepActiveIndex(1, 1, single), 1);
  assert.equal(stepActiveIndex(1, -1, single), 1);
});
test("stepActiveIndex stays put on all-disabled or empty lists", () => {
  assert.equal(stepActiveIndex(1, 1, opts(true, true, true)), 1);
  assert.equal(stepActiveIndex(2, -1, opts(true, true, true)), 2);
  assert.equal(stepActiveIndex(0, 1, []), 0);
});
var FRUIT = [
  { text: "Apple" },
  { text: "Apricot" },
  { text: "Banana" },
  { text: "Avocado", disabled: true },
  { text: "Cherry" }
];
test("typeAheadTarget: a fresh single character searches AFTER the active option", () => {
  assert.equal(typeAheadTarget("a", 0, FRUIT), 1);
  assert.equal(typeAheadTarget("a", 1, FRUIT), 0);
});
test("typeAheadTarget: a multi-character buffer includes the active option", () => {
  assert.equal(typeAheadTarget("ap", 0, FRUIT), 0);
  assert.equal(typeAheadTarget("apr", 0, FRUIT), 1);
});
test("typeAheadTarget is case-insensitive and skips disabled matches", () => {
  assert.equal(typeAheadTarget("CH", 0, FRUIT), 4);
  assert.equal(typeAheadTarget("av", 0, FRUIT), -1);
});
test("typeAheadTarget wraps around and reports no match as -1", () => {
  assert.equal(typeAheadTarget("b", 4, FRUIT), 2);
  assert.equal(typeAheadTarget("z", 0, FRUIT), -1);
  assert.equal(typeAheadTarget("", 0, FRUIT), -1);
  assert.equal(typeAheadTarget("a", 0, []), -1);
});
var place = (trigger, viewport, popup) => computePopupPlacement({ trigger, viewport, popup });
test("placement: opens below the trigger when there is room", () => {
  const p = place(
    { top: 100, bottom: 130, left: 50, width: 150 },
    { width: 1e3, height: 800 },
    { width: 180, height: 200 }
  );
  assert.equal(p.openUp, false);
  assert.equal(p.top, 132);
  assert.equal(p.left, 50);
  assert.equal(p.maxHeight, 320);
  assert.equal(p.minWidth, 150);
  assert.equal(p.maxWidth, 200);
});
test("placement: flips above when below is short and above is roomier", () => {
  const p = place(
    { top: 600, bottom: 630, left: 50, width: 150 },
    { width: 1e3, height: 700 },
    { width: 180, height: 300 }
  );
  assert.equal(p.openUp, true);
  assert.equal(p.top, 298);
  assert.ok(p.top + 300 <= 600, "popup sits fully above the trigger");
  assert.ok(p.top >= 4);
});
test("placement: stays below when above is even shorter than below", () => {
  const p = place(
    { top: 50, bottom: 80, left: 10, width: 100 },
    { width: 500, height: 200 },
    { width: 120, height: 300 }
  );
  assert.equal(p.openUp, false);
  assert.equal(p.top, 82);
  assert.equal(p.maxHeight, 112);
});
test("placement: maxHeight never drops below 80 in a cramped viewport", () => {
  const p = place(
    { top: 10, bottom: 40, left: 10, width: 100 },
    { width: 500, height: 100 },
    { width: 120, height: 300 }
  );
  assert.equal(p.maxHeight, 80);
});
test("placement: clamps the popup inside the right viewport edge", () => {
  const p = place(
    { top: 10, bottom: 40, left: 900, width: 80 },
    { width: 1e3, height: 600 },
    { width: 250, height: 100 }
  );
  assert.equal(p.maxWidth, 200);
  assert.equal(p.left, 796);
});
test("placement: floors left at 4; maxWidth stops at the trigger width", () => {
  const p = place(
    { top: 10, bottom: 40, left: 0, width: 300 },
    { width: 320, height: 600 },
    { width: 400, height: 100 }
  );
  assert.equal(p.maxWidth, 300);
  assert.equal(p.left, 4);
});
test("placement: the viewport caps maxWidth for an over-wide trigger", () => {
  const p = place(
    { top: 10, bottom: 40, left: 0, width: 400 },
    { width: 320, height: 600 },
    { width: 400, height: 100 }
  );
  assert.equal(p.maxWidth, 304);
  assert.equal(p.minWidth, 400);
  assert.equal(p.left, 4);
});
test("placement invariants hold across a sweep of geometries", () => {
  for (const vw of [200, 480, 1024, 2560]) {
    for (const vh of [160, 400, 900]) {
      for (const top of [0, 40, vh * 0.5, vh - 50]) {
        for (const h of [40, 200, 800]) {
          const p = place(
            { top, bottom: top + 30, left: vw * 0.7, width: 120 },
            { width: vw, height: vh },
            { width: 260, height: h }
          );
          assert.ok(p.maxHeight >= 80 && p.maxHeight <= 320, "maxHeight within [80, 320]");
          assert.ok(p.left >= 4, "left keeps the 4px inset");
          assert.ok(p.maxWidth >= 120, "maxWidth keeps the floor");
          assert.equal(p.minWidth, 120);
          if (p.openUp) assert.ok(top > vh - (top + 30), "flips only when above is roomier");
        }
      }
    }
  }
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiY29tYm9ib3gtbG9naWMudGVzdC50cyIsICJjb21ib2JveC1sb2dpYy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gVGVzdHMgZm9yIHRoZSBwdXJlIGhhbGYgb2YgdGhlIGNvbWJvYm94ICh1aS9jb21ib2JveC1sb2dpYy50cyk6IHRoZSBhY3RpdmF0aW9uIGdhdGUgKFVBIG1hdGNoaW5nICsgZm9yY2Ugb3ZlcnJpZGVzKS5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIGlzQnJva2VuRHJvcGRvd25VQSxcbiAgaGFzRm9yY2VQYXJhbSxcbiAgc2hvdWxkRW5hYmxlLFxuICBvcHRpb25UZXh0LFxuICBmaXJzdEVuYWJsZWRJbmRleCxcbiAgbGFzdEVuYWJsZWRJbmRleCxcbiAgc3RlcEFjdGl2ZUluZGV4LFxuICB0eXBlQWhlYWRUYXJnZXQsXG4gIGNvbXB1dGVQb3B1cFBsYWNlbWVudCxcbiAgdHlwZSBPcHRpb25MaWtlLFxuICB0eXBlIFBsYWNlbWVudElucHV0LFxufSBmcm9tICcuL2NvbWJvYm94LWxvZ2ljLnRzJztcblxuLy8gLS0gQWN0aXZhdGlvbiBnYXRpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFRFU0xBX1VBID1cbiAgJ01vemlsbGEvNS4wIChYMTE7IEdOVS9MaW51eCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgJyArXG4gICdDaHJvbWl1bS83OS4wLjM5NDUuMTMwIENocm9tZS83OS4wLjM5NDUuMTMwIFNhZmFyaS81MzcuMzYgVGVzbGEvMjAyMC4xNi4yLjEtZThiMGY0YTU0YjFmJztcbmNvbnN0IFFUX0NBUl9VQSA9XG4gICdNb3ppbGxhLzUuMCAoWDExOyBMaW51eCkgQXBwbGVXZWJLaXQvNTM0LjM0IChLSFRNTCwgbGlrZSBHZWNrbykgUXRDYXJCcm93c2VyIFNhZmFyaS81MzQuMzQnO1xuY29uc3QgREVTS1RPUF9VQSA9XG4gICdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSAnICtcbiAgJ0Nocm9tZS8xMjYuMC4wLjAgU2FmYXJpLzUzNy4zNic7XG5cbnRlc3QoJ2lzQnJva2VuRHJvcGRvd25VQSBtYXRjaGVzIFRlc2xhIGFuZCBRdENhckJyb3dzZXIsIG5vdCBvcmRpbmFyeSBicm93c2VycycsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGlzQnJva2VuRHJvcGRvd25VQShURVNMQV9VQSksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaXNCcm9rZW5Ecm9wZG93blVBKFFUX0NBUl9VQSksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaXNCcm9rZW5Ecm9wZG93blVBKERFU0tUT1BfVUEpLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChpc0Jyb2tlbkRyb3Bkb3duVUEoJ3Rlc2xhJyksIHRydWUpOyAvLyBjYXNlLWluc2Vuc2l0aXZlXG4gIGFzc2VydC5lcXVhbChpc0Jyb2tlbkRyb3Bkb3duVUEoJycpLCBmYWxzZSk7XG59KTtcblxudGVzdCgnaGFzRm9yY2VQYXJhbSBhY2NlcHRzIG9ubHkgYSByZWFsIGNvbWJvYm94PWZvcmNlIHF1ZXJ5IHBhcmFtJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoaGFzRm9yY2VQYXJhbSgnP2NvbWJvYm94PWZvcmNlJyksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoaGFzRm9yY2VQYXJhbSgnP3g9MSZjb21ib2JveD1mb3JjZSZ5PTInKSwgdHJ1ZSk7XG4gIGFzc2VydC5lcXVhbChoYXNGb3JjZVBhcmFtKCc/bm90Y29tYm9ib3g9Zm9yY2UnKSwgZmFsc2UpOyAvLyBubyBbPyZdIGJvdW5kYXJ5XG4gIGFzc2VydC5lcXVhbChoYXNGb3JjZVBhcmFtKCc/Y29tYm9ib3g9Zm9yY2VkJyksIGZhbHNlKTsgLy8gXFxiIGFmdGVyIGZvcmNlXG4gIGFzc2VydC5lcXVhbChoYXNGb3JjZVBhcmFtKCc/Y29tYm9ib3g9b2ZmJyksIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKGhhc0ZvcmNlUGFyYW0oJycpLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChoYXNGb3JjZVBhcmFtKG51bGwpLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChoYXNGb3JjZVBhcmFtKHVuZGVmaW5lZCksIGZhbHNlKTtcbn0pO1xuXG50ZXN0KCdzaG91bGRFbmFibGU6IGZvcmNlIGJ5cGFzc2VzIHRoZSBnYXRlOyB0aGUgZGVmYXVsdCBnYXRlIGlzIG9mZiB1bmRlciBub2RlJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc2hvdWxkRW5hYmxlKHsgZm9yY2U6IHRydWUgfSksIHRydWUpO1xuICAvLyBOb2RlJ3MgbmF2aWdhdG9yLnVzZXJBZ2VudCBpcyBub3QgYSBUZXNsYSwgdGhlcmUgaXMgbm8gbG9jYXRpb24uXG4gIGFzc2VydC5lcXVhbChzaG91bGRFbmFibGUoKSwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwoc2hvdWxkRW5hYmxlKHt9KSwgZmFsc2UpO1xufSk7XG5cbnRlc3QoJ3Nob3VsZEVuYWJsZTogYSBjdXN0b20gbWF0Y2ggcmVjZWl2ZXMgdGhlIFVBIHN0cmluZyBhbmQgZGVjaWRlcycsICgpID0+IHtcbiAgbGV0IHNlZW46IHVua25vd247XG4gIGFzc2VydC5lcXVhbChcbiAgICBzaG91bGRFbmFibGUoeyBtYXRjaDogKHVhKSA9PiB7IHNlZW4gPSB1YTsgcmV0dXJuIHRydWU7IH0gfSksXG4gICAgdHJ1ZSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKHR5cGVvZiBzZWVuLCAnc3RyaW5nJyk7XG4gIGFzc2VydC5lcXVhbChzaG91bGRFbmFibGUoeyBtYXRjaDogKCkgPT4gZmFsc2UgfSksIGZhbHNlKTtcbn0pO1xuXG50ZXN0KCdzaG91bGRFbmFibGU6IHRoZSBfX0pTX0NPTUJPQk9YX0ZPUkNFX18gZ2xvYmFsIG92ZXJyaWRlcycsICgpID0+IHtcbiAgY29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgeyBfX0pTX0NPTUJPQk9YX0ZPUkNFX18/OiBib29sZWFuIH07XG4gIGFzc2VydC5lcXVhbChzaG91bGRFbmFibGUoKSwgZmFsc2UpO1xuICBnLl9fSlNfQ09NQk9CT1hfRk9SQ0VfXyA9IHRydWU7XG4gIHRyeSB7XG4gICAgYXNzZXJ0LmVxdWFsKHNob3VsZEVuYWJsZSgpLCB0cnVlKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBkZWxldGUgZy5fX0pTX0NPTUJPQk9YX0ZPUkNFX187XG4gIH1cbiAgYXNzZXJ0LmVxdWFsKHNob3VsZEVuYWJsZSgpLCBmYWxzZSk7XG59KTtcblxuLy8gLS0gb3B0aW9uVGV4dCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnb3B0aW9uVGV4dCBwcmVmZXJzIHRleHRDb250ZW50LCBmYWxscyBiYWNrIHRvIHZhbHVlLCBuZXZlciByZXR1cm5zIG51bGwnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChvcHRpb25UZXh0KHsgdGV4dENvbnRlbnQ6ICdMYWJlbCcsIHZhbHVlOiAndicgfSksICdMYWJlbCcpO1xuICBhc3NlcnQuZXF1YWwob3B0aW9uVGV4dCh7IHRleHRDb250ZW50OiAnJywgdmFsdWU6ICd2JyB9KSwgJ3YnKTtcbiAgYXNzZXJ0LmVxdWFsKG9wdGlvblRleHQoeyB0ZXh0Q29udGVudDogbnVsbCwgdmFsdWU6ICd2JyB9KSwgJ3YnKTtcbiAgYXNzZXJ0LmVxdWFsKG9wdGlvblRleHQoeyB0ZXh0Q29udGVudDogJycsIHZhbHVlOiAnJyB9KSwgJycpO1xuICBhc3NlcnQuZXF1YWwob3B0aW9uVGV4dCh1bmRlZmluZWQpLCAnJyk7XG4gIGFzc2VydC5lcXVhbChvcHRpb25UZXh0KG51bGwpLCAnJyk7XG59KTtcblxuLy8gLS0gRW5hYmxlZC1vcHRpb24gbmF2aWdhdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBvcHRzID0gKC4uLmRpc2FibGVkOiBib29sZWFuW10pOiB7IGRpc2FibGVkOiBib29sZWFuIH1bXSA9PlxuICBkaXNhYmxlZC5tYXAoKGQpID0+ICh7IGRpc2FibGVkOiBkIH0pKTtcblxudGVzdCgnZmlyc3RFbmFibGVkSW5kZXggLyBsYXN0RW5hYmxlZEluZGV4IHNraXAgZGlzYWJsZWQgZW5kcycsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGZpcnN0RW5hYmxlZEluZGV4KG9wdHMoZmFsc2UsIGZhbHNlKSksIDApO1xuICBhc3NlcnQuZXF1YWwobGFzdEVuYWJsZWRJbmRleChvcHRzKGZhbHNlLCBmYWxzZSkpLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKGZpcnN0RW5hYmxlZEluZGV4KG9wdHModHJ1ZSwgZmFsc2UsIHRydWUpKSwgMSk7XG4gIGFzc2VydC5lcXVhbChsYXN0RW5hYmxlZEluZGV4KG9wdHModHJ1ZSwgZmFsc2UsIHRydWUpKSwgMSk7XG4gIGFzc2VydC5lcXVhbChmaXJzdEVuYWJsZWRJbmRleChvcHRzKHRydWUsIHRydWUsIGZhbHNlLCBmYWxzZSkpLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKGxhc3RFbmFibGVkSW5kZXgob3B0cyhmYWxzZSwgZmFsc2UsIHRydWUsIHRydWUpKSwgMSk7XG59KTtcblxudGVzdCgnZmlyc3RFbmFibGVkSW5kZXggLyBsYXN0RW5hYmxlZEluZGV4IGZhbGwgYmFjayBvbiBhbGwtZGlzYWJsZWQgYW5kIGVtcHR5IGxpc3RzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoZmlyc3RFbmFibGVkSW5kZXgob3B0cyh0cnVlLCB0cnVlKSksIDApO1xuICBhc3NlcnQuZXF1YWwobGFzdEVuYWJsZWRJbmRleChvcHRzKHRydWUsIHRydWUpKSwgMSk7XG4gIGFzc2VydC5lcXVhbChmaXJzdEVuYWJsZWRJbmRleChbXSksIDApO1xuICBhc3NlcnQuZXF1YWwobGFzdEVuYWJsZWRJbmRleChbXSksIC0xKTtcbn0pO1xuXG50ZXN0KCdzdGVwQWN0aXZlSW5kZXggc3RlcHMgYW5kIHdyYXBzIGluIGJvdGggZGlyZWN0aW9ucycsICgpID0+IHtcbiAgY29uc3QgYWxsID0gb3B0cyhmYWxzZSwgZmFsc2UsIGZhbHNlLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChzdGVwQWN0aXZlSW5kZXgoMCwgMSwgYWxsKSwgMSk7XG4gIGFzc2VydC5lcXVhbChzdGVwQWN0aXZlSW5kZXgoMywgMSwgYWxsKSwgMCk7IC8vIHdyYXAgZm9yd2FyZFxuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDAsIC0xLCBhbGwpLCAzKTsgLy8gd3JhcCBiYWNrd2FyZFxuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDIsIC0xLCBhbGwpLCAxKTtcbn0pO1xuXG50ZXN0KCdzdGVwQWN0aXZlSW5kZXggc2tpcHMgZGlzYWJsZWQgb3B0aW9ucycsICgpID0+IHtcbiAgY29uc3QgbWlkID0gb3B0cyhmYWxzZSwgdHJ1ZSwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDAsIDEsIG1pZCksIDIpO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDIsIDEsIG1pZCksIDApO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDAsIC0xLCBtaWQpLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKHN0ZXBBY3RpdmVJbmRleCgyLCAtMSwgbWlkKSwgMCk7XG4gIGNvbnN0IHNpbmdsZSA9IG9wdHModHJ1ZSwgZmFsc2UsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDAsIDEsIHNpbmdsZSksIDEpO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDEsIDEsIHNpbmdsZSksIDEpOyAvLyBmdWxsIGxhcCBiYWNrIHRvIHRoZSBvbmx5IGVuYWJsZWQgb25lXG4gIGFzc2VydC5lcXVhbChzdGVwQWN0aXZlSW5kZXgoMSwgLTEsIHNpbmdsZSksIDEpO1xufSk7XG5cbnRlc3QoJ3N0ZXBBY3RpdmVJbmRleCBzdGF5cyBwdXQgb24gYWxsLWRpc2FibGVkIG9yIGVtcHR5IGxpc3RzJywgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDEsIDEsIG9wdHModHJ1ZSwgdHJ1ZSwgdHJ1ZSkpLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKHN0ZXBBY3RpdmVJbmRleCgyLCAtMSwgb3B0cyh0cnVlLCB0cnVlLCB0cnVlKSksIDIpO1xuICBhc3NlcnQuZXF1YWwoc3RlcEFjdGl2ZUluZGV4KDAsIDEsIFtdKSwgMCk7XG59KTtcblxuLy8gLS0gVHlwZS1haGVhZCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEZSVUlUOiBPcHRpb25MaWtlW10gPSBbXG4gIHsgdGV4dDogJ0FwcGxlJyB9LFxuICB7IHRleHQ6ICdBcHJpY290JyB9LFxuICB7IHRleHQ6ICdCYW5hbmEnIH0sXG4gIHsgdGV4dDogJ0F2b2NhZG8nLCBkaXNhYmxlZDogdHJ1ZSB9LFxuICB7IHRleHQ6ICdDaGVycnknIH0sXG5dO1xuXG50ZXN0KCd0eXBlQWhlYWRUYXJnZXQ6IGEgZnJlc2ggc2luZ2xlIGNoYXJhY3RlciBzZWFyY2hlcyBBRlRFUiB0aGUgYWN0aXZlIG9wdGlvbicsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKHR5cGVBaGVhZFRhcmdldCgnYScsIDAsIEZSVUlUKSwgMSk7IC8vIEFwcGxlIGFjdGl2ZSAtPiBBcHJpY290XG4gIC8vIEZyb20gQXByaWNvdCwgdGhlIG5leHQgJ2EnIG1hdGNoIHdyYXBzIHBhc3QgZGlzYWJsZWQgQXZvY2FkbyBiYWNrIHRvIEFwcGxlLlxuICBhc3NlcnQuZXF1YWwodHlwZUFoZWFkVGFyZ2V0KCdhJywgMSwgRlJVSVQpLCAwKTtcbn0pO1xuXG50ZXN0KCd0eXBlQWhlYWRUYXJnZXQ6IGEgbXVsdGktY2hhcmFjdGVyIGJ1ZmZlciBpbmNsdWRlcyB0aGUgYWN0aXZlIG9wdGlvbicsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKHR5cGVBaGVhZFRhcmdldCgnYXAnLCAwLCBGUlVJVCksIDApOyAvLyBBcHBsZSBrZWVwcyBtYXRjaGluZyBhcyB0aGUgYnVmZmVyIGdyb3dzXG4gIGFzc2VydC5lcXVhbCh0eXBlQWhlYWRUYXJnZXQoJ2FwcicsIDAsIEZSVUlUKSwgMSk7XG59KTtcblxudGVzdCgndHlwZUFoZWFkVGFyZ2V0IGlzIGNhc2UtaW5zZW5zaXRpdmUgYW5kIHNraXBzIGRpc2FibGVkIG1hdGNoZXMnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbCh0eXBlQWhlYWRUYXJnZXQoJ0NIJywgMCwgRlJVSVQpLCA0KTtcbiAgYXNzZXJ0LmVxdWFsKHR5cGVBaGVhZFRhcmdldCgnYXYnLCAwLCBGUlVJVCksIC0xKTsgLy8gb25seSB0aGUgZGlzYWJsZWQgQXZvY2FkbyBtYXRjaGVzXG59KTtcblxudGVzdCgndHlwZUFoZWFkVGFyZ2V0IHdyYXBzIGFyb3VuZCBhbmQgcmVwb3J0cyBubyBtYXRjaCBhcyAtMScsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKHR5cGVBaGVhZFRhcmdldCgnYicsIDQsIEZSVUlUKSwgMik7IC8vIHdyYXBzIGZyb20gQ2hlcnJ5IHRvIEJhbmFuYVxuICBhc3NlcnQuZXF1YWwodHlwZUFoZWFkVGFyZ2V0KCd6JywgMCwgRlJVSVQpLCAtMSk7XG4gIGFzc2VydC5lcXVhbCh0eXBlQWhlYWRUYXJnZXQoJycsIDAsIEZSVUlUKSwgLTEpO1xuICBhc3NlcnQuZXF1YWwodHlwZUFoZWFkVGFyZ2V0KCdhJywgMCwgW10pLCAtMSk7XG59KTtcblxuLy8gLS0gUG9wdXAgcGxhY2VtZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBwbGFjZSA9IChcbiAgdHJpZ2dlcjogUGxhY2VtZW50SW5wdXRbJ3RyaWdnZXInXSxcbiAgdmlld3BvcnQ6IFBsYWNlbWVudElucHV0Wyd2aWV3cG9ydCddLFxuICBwb3B1cDogUGxhY2VtZW50SW5wdXRbJ3BvcHVwJ10sXG4pID0+IGNvbXB1dGVQb3B1cFBsYWNlbWVudCh7IHRyaWdnZXIsIHZpZXdwb3J0LCBwb3B1cCB9KTtcblxudGVzdCgncGxhY2VtZW50OiBvcGVucyBiZWxvdyB0aGUgdHJpZ2dlciB3aGVuIHRoZXJlIGlzIHJvb20nLCAoKSA9PiB7XG4gIGNvbnN0IHAgPSBwbGFjZShcbiAgICB7IHRvcDogMTAwLCBib3R0b206IDEzMCwgbGVmdDogNTAsIHdpZHRoOiAxNTAgfSxcbiAgICB7IHdpZHRoOiAxMDAwLCBoZWlnaHQ6IDgwMCB9LFxuICAgIHsgd2lkdGg6IDE4MCwgaGVpZ2h0OiAyMDAgfSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKHAub3BlblVwLCBmYWxzZSk7XG4gIGFzc2VydC5lcXVhbChwLnRvcCwgMTMyKTtcbiAgYXNzZXJ0LmVxdWFsKHAubGVmdCwgNTApO1xuICBhc3NlcnQuZXF1YWwocC5tYXhIZWlnaHQsIDMyMCk7XG4gIGFzc2VydC5lcXVhbChwLm1pbldpZHRoLCAxNTApO1xuICBhc3NlcnQuZXF1YWwocC5tYXhXaWR0aCwgMjAwKTtcbn0pO1xuXG50ZXN0KCdwbGFjZW1lbnQ6IGZsaXBzIGFib3ZlIHdoZW4gYmVsb3cgaXMgc2hvcnQgYW5kIGFib3ZlIGlzIHJvb21pZXInLCAoKSA9PiB7XG4gIGNvbnN0IHAgPSBwbGFjZShcbiAgICB7IHRvcDogNjAwLCBib3R0b206IDYzMCwgbGVmdDogNTAsIHdpZHRoOiAxNTAgfSxcbiAgICB7IHdpZHRoOiAxMDAwLCBoZWlnaHQ6IDcwMCB9LFxuICAgIHsgd2lkdGg6IDE4MCwgaGVpZ2h0OiAzMDAgfSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKHAub3BlblVwLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKHAudG9wLCAyOTgpO1xuICBhc3NlcnQub2socC50b3AgKyAzMDAgPD0gNjAwLCAncG9wdXAgc2l0cyBmdWxseSBhYm92ZSB0aGUgdHJpZ2dlcicpO1xuICBhc3NlcnQub2socC50b3AgPj0gNCk7XG59KTtcblxudGVzdCgncGxhY2VtZW50OiBzdGF5cyBiZWxvdyB3aGVuIGFib3ZlIGlzIGV2ZW4gc2hvcnRlciB0aGFuIGJlbG93JywgKCkgPT4ge1xuICBjb25zdCBwID0gcGxhY2UoXG4gICAgeyB0b3A6IDUwLCBib3R0b206IDgwLCBsZWZ0OiAxMCwgd2lkdGg6IDEwMCB9LFxuICAgIHsgd2lkdGg6IDUwMCwgaGVpZ2h0OiAyMDAgfSxcbiAgICB7IHdpZHRoOiAxMjAsIGhlaWdodDogMzAwIH0sXG4gICk7XG4gIGFzc2VydC5lcXVhbChwLm9wZW5VcCwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwocC50b3AsIDgyKTtcbiAgYXNzZXJ0LmVxdWFsKHAubWF4SGVpZ2h0LCAxMTIpO1xufSk7XG5cbnRlc3QoJ3BsYWNlbWVudDogbWF4SGVpZ2h0IG5ldmVyIGRyb3BzIGJlbG93IDgwIGluIGEgY3JhbXBlZCB2aWV3cG9ydCcsICgpID0+IHtcbiAgY29uc3QgcCA9IHBsYWNlKFxuICAgIHsgdG9wOiAxMCwgYm90dG9tOiA0MCwgbGVmdDogMTAsIHdpZHRoOiAxMDAgfSxcbiAgICB7IHdpZHRoOiA1MDAsIGhlaWdodDogMTAwIH0sXG4gICAgeyB3aWR0aDogMTIwLCBoZWlnaHQ6IDMwMCB9LFxuICApO1xuICBhc3NlcnQuZXF1YWwocC5tYXhIZWlnaHQsIDgwKTtcbn0pO1xuXG50ZXN0KCdwbGFjZW1lbnQ6IGNsYW1wcyB0aGUgcG9wdXAgaW5zaWRlIHRoZSByaWdodCB2aWV3cG9ydCBlZGdlJywgKCkgPT4ge1xuICBjb25zdCBwID0gcGxhY2UoXG4gICAgeyB0b3A6IDEwLCBib3R0b206IDQwLCBsZWZ0OiA5MDAsIHdpZHRoOiA4MCB9LFxuICAgIHsgd2lkdGg6IDEwMDAsIGhlaWdodDogNjAwIH0sXG4gICAgeyB3aWR0aDogMjUwLCBoZWlnaHQ6IDEwMCB9LFxuICApO1xuICBhc3NlcnQuZXF1YWwocC5tYXhXaWR0aCwgMjAwKTtcbiAgYXNzZXJ0LmVxdWFsKHAubGVmdCwgNzk2KTtcbn0pO1xuXG50ZXN0KCdwbGFjZW1lbnQ6IGZsb29ycyBsZWZ0IGF0IDQ7IG1heFdpZHRoIHN0b3BzIGF0IHRoZSB0cmlnZ2VyIHdpZHRoJywgKCkgPT4ge1xuICBjb25zdCBwID0gcGxhY2UoXG4gICAgeyB0b3A6IDEwLCBib3R0b206IDQwLCBsZWZ0OiAwLCB3aWR0aDogMzAwIH0sXG4gICAgeyB3aWR0aDogMzIwLCBoZWlnaHQ6IDYwMCB9LFxuICAgIHsgd2lkdGg6IDQwMCwgaGVpZ2h0OiAxMDAgfSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKHAubWF4V2lkdGgsIDMwMCk7XG4gIGFzc2VydC5lcXVhbChwLmxlZnQsIDQpO1xufSk7XG5cbnRlc3QoJ3BsYWNlbWVudDogdGhlIHZpZXdwb3J0IGNhcHMgbWF4V2lkdGggZm9yIGFuIG92ZXItd2lkZSB0cmlnZ2VyJywgKCkgPT4ge1xuICBjb25zdCBwID0gcGxhY2UoXG4gICAgeyB0b3A6IDEwLCBib3R0b206IDQwLCBsZWZ0OiAwLCB3aWR0aDogNDAwIH0sXG4gICAgeyB3aWR0aDogMzIwLCBoZWlnaHQ6IDYwMCB9LFxuICAgIHsgd2lkdGg6IDQwMCwgaGVpZ2h0OiAxMDAgfSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKHAubWF4V2lkdGgsIDMwNCk7XG4gIGFzc2VydC5lcXVhbChwLm1pbldpZHRoLCA0MDApOyAvLyBtaW4td2lkdGggd2lucyBvdmVyIG1heC13aWR0aCwgYXMgaW4gQ1NTXG4gIGFzc2VydC5lcXVhbChwLmxlZnQsIDQpO1xufSk7XG5cbnRlc3QoJ3BsYWNlbWVudCBpbnZhcmlhbnRzIGhvbGQgYWNyb3NzIGEgc3dlZXAgb2YgZ2VvbWV0cmllcycsICgpID0+IHtcbiAgZm9yIChjb25zdCB2dyBvZiBbMjAwLCA0ODAsIDEwMjQsIDI1NjBdKSB7XG4gICAgZm9yIChjb25zdCB2aCBvZiBbMTYwLCA0MDAsIDkwMF0pIHtcbiAgICAgIGZvciAoY29uc3QgdG9wIG9mIFswLCA0MCwgdmggKiAwLjUsIHZoIC0gNTBdKSB7XG4gICAgICAgIGZvciAoY29uc3QgaCBvZiBbNDAsIDIwMCwgODAwXSkge1xuICAgICAgICAgIGNvbnN0IHAgPSBwbGFjZShcbiAgICAgICAgICAgIHsgdG9wLCBib3R0b206IHRvcCArIDMwLCBsZWZ0OiB2dyAqIDAuNywgd2lkdGg6IDEyMCB9LFxuICAgICAgICAgICAgeyB3aWR0aDogdncsIGhlaWdodDogdmggfSxcbiAgICAgICAgICAgIHsgd2lkdGg6IDI2MCwgaGVpZ2h0OiBoIH0sXG4gICAgICAgICAgKTtcbiAgICAgICAgICBhc3NlcnQub2socC5tYXhIZWlnaHQgPj0gODAgJiYgcC5tYXhIZWlnaHQgPD0gMzIwLCAnbWF4SGVpZ2h0IHdpdGhpbiBbODAsIDMyMF0nKTtcbiAgICAgICAgICBhc3NlcnQub2socC5sZWZ0ID49IDQsICdsZWZ0IGtlZXBzIHRoZSA0cHggaW5zZXQnKTtcbiAgICAgICAgICBhc3NlcnQub2socC5tYXhXaWR0aCA+PSAxMjAsICdtYXhXaWR0aCBrZWVwcyB0aGUgZmxvb3InKTtcbiAgICAgICAgICBhc3NlcnQuZXF1YWwocC5taW5XaWR0aCwgMTIwKTtcbiAgICAgICAgICBpZiAocC5vcGVuVXApIGFzc2VydC5vayh0b3AgPiB2aCAtICh0b3AgKyAzMCksICdmbGlwcyBvbmx5IHdoZW4gYWJvdmUgaXMgcm9vbWllcicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59KTtcbiIsICIvKiogUHVyZSBsb2dpYyBmb3IgdWkvY29tYm9ib3gudHMgXHUyMDE0IG5vIERPTSBvciBicm93c2VyIEFQSXMsIHVuaXQtdGVzdGVkIHVuZGVyXG4gKiBub2RlLiAqL1xuXG4vLyAtLSBBY3RpdmF0aW9uIGdhdGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBFbmFibGVPcHRpb25zIHtcbiAgLyoqIEJ5cGFzcyB0aGUgdXNlci1hZ2VudCBnYXRlIGVudGlyZWx5LiAqL1xuICBmb3JjZT86IGJvb2xlYW47XG4gIC8qKiBDdXN0b20gVUEgdGVzdC4gRGVmYXVsdCBtYXRjaGVzIFRlc2xhJ3MgaW4tY2FyIGJyb3dzZXIuICovXG4gIG1hdGNoPzogKHVzZXJBZ2VudDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG4vKiogVGhlIGRlZmF1bHQgdXNlci1hZ2VudCBnYXRlOiBicm93c2VycyB3aG9zZSBOQVRJVkUgYDxzZWxlY3Q+YCBkcm9wZG93biBpc1xuICoga25vd24tYnJva2VuLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQnJva2VuRHJvcGRvd25VQSh1c2VyQWdlbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1Rlc2xhfFF0Q2FyQnJvd3Nlci9pLnRlc3QodXNlckFnZW50KTtcbn1cblxuLyoqIFdoZXRoZXIgYSBgbG9jYXRpb24uc2VhcmNoYC1zdHlsZSBxdWVyeSBzdHJpbmcgY2FycmllcyBgY29tYm9ib3g9Zm9yY2VgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhhc0ZvcmNlUGFyYW0oc2VhcmNoOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiB7XG4gIHJldHVybiAhIXNlYXJjaCAmJiAvWz8mXWNvbWJvYm94PWZvcmNlXFxiLy50ZXN0KHNlYXJjaCk7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZmFsbGJhY2sgc2hvdWxkIGFjdGl2YXRlLiBUcnVlIGlmIGBmb3JjZWAsIHRoZSBVQSBtYXRjaGVzXG4gKiAoVGVzbGEgYnkgZGVmYXVsdCksIG9yIGEgbWFudWFsIG92ZXJyaWRlIGlzIHNldDogYD9jb21ib2JveD1mb3JjZWAsXG4gKiBgbG9jYWxTdG9yYWdlWydqcy1jb21ib2JveCddID09PSAnZm9yY2UnYCwgb3JcbiAqIGBnbG9iYWxUaGlzLl9fSlNfQ09NQk9CT1hfRk9SQ0VfXyA9IHRydWVgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkRW5hYmxlKG9wdHM6IEVuYWJsZU9wdGlvbnMgPSB7fSk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGlmIChvcHRzLmZvcmNlKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoKGdsb2JhbFRoaXMgYXMgeyBfX0pTX0NPTUJPQk9YX0ZPUkNFX18/OiB1bmtub3duIH0pLl9fSlNfQ09NQk9CT1hfRk9SQ0VfXykgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgbWF0Y2ggPSBvcHRzLm1hdGNoID8/IGlzQnJva2VuRHJvcGRvd25VQTtcbiAgICBpZiAobWF0Y2goZ2xvYmFsVGhpcy5uYXZpZ2F0b3I/LnVzZXJBZ2VudCA/PyAnJykpIHJldHVybiB0cnVlO1xuICAgIHRyeSB7XG4gICAgICBpZiAoZ2xvYmFsVGhpcy5sb2NhbFN0b3JhZ2UgJiYgbG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2pzLWNvbWJvYm94JykgPT09ICdmb3JjZScpIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgIH1cbiAgICBpZiAoaGFzRm9yY2VQYXJhbShnbG9iYWxUaGlzLmxvY2F0aW9uPy5zZWFyY2gpKSByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyAtLSBPcHRpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBvcHRpb24gc2hhcGUgdGhlIHB1cmUgbmF2aWdhdGlvbi90eXBlLWFoZWFkIGhlbHBlcnMgd29yayBvbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgT3B0aW9uTGlrZSB7XG4gIC8qKiBEaXNwbGF5IHRleHQgKHdoYXQgdHlwZS1haGVhZCBtYXRjaGVzIGFnYWluc3QpLiAqL1xuICB0ZXh0OiBzdHJpbmc7XG4gIGRpc2FibGVkPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBBbiBvcHRpb24ncyBkaXNwbGF5IHRleHQ6IGB0ZXh0Q29udGVudGAsIGVsc2UgYHZhbHVlYCwgZWxzZSAnJy4gU3RydWN0dXJhbCxcbiAqIHNvIGl0IHRha2VzIGEgcmVhbCBIVE1MT3B0aW9uRWxlbWVudCBvciBhbnkgYHsgdGV4dENvbnRlbnQ/LCB2YWx1ZT8gfWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcHRpb25UZXh0KFxuICBvcHQ6IHsgdGV4dENvbnRlbnQ/OiBzdHJpbmcgfCBudWxsOyB2YWx1ZT86IHN0cmluZyB9IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB7XG4gIHJldHVybiAob3B0ICYmIChvcHQudGV4dENvbnRlbnQgfHwgb3B0LnZhbHVlKSkgfHwgJyc7XG59XG5cbi8qICovXG5leHBvcnQgZnVuY3Rpb24gZmlyc3RFbmFibGVkSW5kZXgob3B0aW9uczogcmVhZG9ubHkgeyBkaXNhYmxlZD86IGJvb2xlYW4gfVtdKTogbnVtYmVyIHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBvcHRpb25zLmxlbmd0aDsgaSsrKSBpZiAoIW9wdGlvbnNbaV0uZGlzYWJsZWQpIHJldHVybiBpO1xuICByZXR1cm4gMDtcbn1cblxuLyogKi9cbmV4cG9ydCBmdW5jdGlvbiBsYXN0RW5hYmxlZEluZGV4KG9wdGlvbnM6IHJlYWRvbmx5IHsgZGlzYWJsZWQ/OiBib29sZWFuIH1bXSk6IG51bWJlciB7XG4gIGZvciAobGV0IGkgPSBvcHRpb25zLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoIW9wdGlvbnNbaV0uZGlzYWJsZWQpIHJldHVybiBpO1xuICByZXR1cm4gb3B0aW9ucy5sZW5ndGggLSAxO1xufVxuXG4vKldpdGggZXZlcnkgb3B0aW9uIGRpc2FibGVkIHRoZSBzdGVwIGxhbmRzIGJhY2sgb24gYGN1cnJlbnRgIChhIGZ1bGwgbGFwXG4gKiBjaGFuZ2VzIG5vdGhpbmcpOyBhbiBlbXB0eSBsaXN0IHJldHVybnMgYGN1cnJlbnRgIHVudG91Y2hlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGVwQWN0aXZlSW5kZXgoXG4gIGN1cnJlbnQ6IG51bWJlcixcbiAgZGlyOiBudW1iZXIsXG4gIG9wdGlvbnM6IHJlYWRvbmx5IHsgZGlzYWJsZWQ/OiBib29sZWFuIH1bXSxcbik6IG51bWJlciB7XG4gIGxldCBpID0gY3VycmVudDtcbiAgZm9yIChsZXQgbiA9IDA7IG4gPCBvcHRpb25zLmxlbmd0aDsgbisrKSB7XG4gICAgaSA9IChpICsgZGlyICsgb3B0aW9ucy5sZW5ndGgpICUgb3B0aW9ucy5sZW5ndGg7XG4gICAgaWYgKCFvcHRpb25zW2ldLmRpc2FibGVkKSBicmVhaztcbiAgfVxuICByZXR1cm4gaTtcbn1cblxuLyoqIFR5cGUtYWhlYWQgdGFyZ2V0OiB0aGUgZmlyc3QgZW5hYmxlZCBvcHRpb24gd2hvc2UgdGV4dCBzdGFydHMgd2l0aCBgYnVmZmVyYCAoY2FzZS1pbnNlbnNpdGl2ZSksIHNlYXJjaGluZyBmb3J3YXJkIHdpdGggd3JhcC1hcm91bmQuIEEgZnJlc2ggc2luZ2xlLWNoYXJhY3RlciBidWZmZXIgc3RhcnRzIEFGVEVSIHRoZSBhY3RpdmUgb3B0aW9uIChzbyByZXBlYXRpbmcgYSBwcmVmaXggd2Fsa3MgdGhyb3VnaCB0aGUgbWF0Y2hlcyk7IGEgbXVsdGktY2hhcmFjdGVyIGJ1ZmZlciBpbmNsdWRlcyBpdCAodGhlIG1hdGNoIHVuZGVyIHRoZSBjYXJldCBzaG91bGQga2VlcCBtYXRjaGluZyBhcyB0aGUgYnVmZmVyIGdyb3dzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0eXBlQWhlYWRUYXJnZXQoXG4gIGJ1ZmZlcjogc3RyaW5nLFxuICBhY3RpdmVJbmRleDogbnVtYmVyLFxuICBvcHRpb25zOiByZWFkb25seSBPcHRpb25MaWtlW10sXG4pOiBudW1iZXIge1xuICBjb25zdCBidWYgPSBidWZmZXIudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFidWYpIHJldHVybiAtMTtcbiAgY29uc3Qgc3RhcnRBdCA9IGJ1Zi5sZW5ndGggPT09IDEgPyBhY3RpdmVJbmRleCArIDEgOiBhY3RpdmVJbmRleDtcbiAgZm9yIChsZXQgbiA9IDA7IG4gPCBvcHRpb25zLmxlbmd0aDsgbisrKSB7XG4gICAgY29uc3QgaSA9IChzdGFydEF0ICsgbiArIG9wdGlvbnMubGVuZ3RoKSAlIG9wdGlvbnMubGVuZ3RoO1xuICAgIGlmICghb3B0aW9uc1tpXS5kaXNhYmxlZCAmJiBvcHRpb25zW2ldLnRleHQudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKGJ1ZikpIHJldHVybiBpO1xuICB9XG4gIHJldHVybiAtMTtcbn1cblxuLy8gLS0gUG9wdXAgcGxhY2VtZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxhY2VtZW50SW5wdXQge1xuICAvKiogVGhlIHRyaWdnZXIncyBib3VuZGluZyByZWN0IGluIHZpZXdwb3J0IGNvb3JkaW5hdGVzLiAqL1xuICB0cmlnZ2VyOiB7IHRvcDogbnVtYmVyOyBib3R0b206IG51bWJlcjsgbGVmdDogbnVtYmVyOyB3aWR0aDogbnVtYmVyIH07XG4gIC8qKiBWaWV3cG9ydCBzaXplICh3aW5kb3cuaW5uZXJXaWR0aC9pbm5lckhlaWdodCkuICovXG4gIHZpZXdwb3J0OiB7IHdpZHRoOiBudW1iZXI7IGhlaWdodDogbnVtYmVyIH07XG4gIC8qKiBUaGUgcG9wdXAncyBuYXR1cmFsICh1bmNvbnN0cmFpbmVkKSBtZWFzdXJlZCBzaXplLiAqL1xuICBwb3B1cDogeyB3aWR0aDogbnVtYmVyOyBoZWlnaHQ6IG51bWJlciB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcHVwUGxhY2VtZW50IHtcbiAgdG9wOiBudW1iZXI7XG4gIGxlZnQ6IG51bWJlcjtcbiAgLyogKi9cbiAgbWF4SGVpZ2h0OiBudW1iZXI7XG4gIC8qKiBXaWR0aCBmbG9vcjogdGhlIHRyaWdnZXIncyBvd24gd2lkdGguICovXG4gIG1pbldpZHRoOiBudW1iZXI7XG4gIC8qICovXG4gIG1heFdpZHRoOiBudW1iZXI7XG4gIC8qKiBUcnVlIHdoZW4gdGhlIHBvcHVwIG9wZW5zIGFib3ZlIHRoZSB0cmlnZ2VyIChtb3JlIHJvb20gdGhlcmUpLiAqL1xuICBvcGVuVXA6IGJvb2xlYW47XG59XG5cbi8qKiBXaGVyZSBhIGZpeGVkLXBvc2l0aW9uIHBvcHVwIGdvZXMgcmVsYXRpdmUgdG8gaXRzIHRyaWdnZXIuIFByZWZlcnNcbiAqIGJlbG93OyBmbGlwcyBhYm92ZSB3aGVuIHRoZSBzcGFjZSBiZWxvdyBjYW4ndCBmaXQgdGhlICgzMjBweC1jYXBwZWQpXG4gKiBwb3B1cCBhbmQgdGhlcmUgaXMgbW9yZSByb29tIGFib3ZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVQb3B1cFBsYWNlbWVudChpbnB1dDogUGxhY2VtZW50SW5wdXQpOiBQb3B1cFBsYWNlbWVudCB7XG4gIGNvbnN0IHIgPSBpbnB1dC50cmlnZ2VyO1xuICBjb25zdCB2dyA9IGlucHV0LnZpZXdwb3J0LndpZHRoO1xuICBjb25zdCB2aCA9IGlucHV0LnZpZXdwb3J0LmhlaWdodDtcblxuICBjb25zdCBtaW5XaWR0aCA9IHIud2lkdGg7XG4gIGNvbnN0IG1heFdpZHRoID0gTWF0aC5taW4oTWF0aC5tYXgoci53aWR0aCwgMjAwKSwgTWF0aC5tYXgodncgLSAxNiwgMTIwKSk7XG5cbiAgY29uc3Qgc3BhY2VCZWxvdyA9IHZoIC0gci5ib3R0b207XG4gIGNvbnN0IHNwYWNlQWJvdmUgPSByLnRvcDtcbiAgY29uc3QgbmF0dXJhbEhlaWdodCA9IGlucHV0LnBvcHVwLmhlaWdodCB8fCAwO1xuICBjb25zdCBkZXNpcmVkID0gTWF0aC5taW4obmF0dXJhbEhlaWdodCwgMzIwKTtcbiAgY29uc3Qgb3BlblVwID0gc3BhY2VCZWxvdyA8IGRlc2lyZWQgJiYgc3BhY2VBYm92ZSA+IHNwYWNlQmVsb3c7XG5cbiAgbGV0IHRvcDogbnVtYmVyO1xuICBsZXQgbWF4SGVpZ2h0OiBudW1iZXI7XG4gIGlmIChvcGVuVXApIHtcbiAgICBtYXhIZWlnaHQgPSBNYXRoLm1heCg4MCwgTWF0aC5taW4oc3BhY2VBYm92ZSAtIDgsIDMyMCkpO1xuICAgIGNvbnN0IHNob3duID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obmF0dXJhbEhlaWdodCwgbWF4SGVpZ2h0LCBzcGFjZUFib3ZlIC0gOCkpO1xuICAgIHRvcCA9IE1hdGgubWF4KDQsIHIudG9wIC0gMiAtIHNob3duKTtcbiAgfSBlbHNlIHtcbiAgICBtYXhIZWlnaHQgPSBNYXRoLm1heCg4MCwgTWF0aC5taW4oc3BhY2VCZWxvdyAtIDgsIDMyMCkpO1xuICAgIHRvcCA9IHIuYm90dG9tICsgMjtcbiAgfVxuXG4gIC8vIEVmZmVjdGl2ZSByZW5kZXJlZCB3aWR0aCBhZnRlciB0aGUgQ1NTIG1pbi9tYXggY2xhbXBzIGFib3ZlIChtaW4td2lkdGggd2lucyBvdmVyIG1heC13aWR0aCwgYXMgaW4gQ1NTKS5cbiAgY29uc3Qgd2lkdGggPSBNYXRoLm1heChNYXRoLm1pbihpbnB1dC5wb3B1cC53aWR0aCB8fCByLndpZHRoLCBtYXhXaWR0aCksIG1pbldpZHRoKTtcbiAgbGV0IGxlZnQgPSByLmxlZnQ7XG4gIGlmIChsZWZ0ICsgd2lkdGggPiB2dyAtIDQpIGxlZnQgPSBNYXRoLm1heCg0LCB2dyAtIDQgLSB3aWR0aCk7XG4gIGlmIChsZWZ0IDwgNCkgbGVmdCA9IDQ7XG5cbiAgcmV0dXJuIHsgdG9wLCBsZWZ0LCBtYXhIZWlnaHQsIG1pbldpZHRoLCBtYXhXaWR0aCwgb3BlblVwIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBRUEsU0FBUyxZQUFZO0FBQ3JCLE9BQU8sWUFBWTs7O0FDV1osU0FBUyxtQkFBbUIsV0FBNEI7QUFDN0QsU0FBTyxzQkFBc0IsS0FBSyxTQUFTO0FBQzdDO0FBR08sU0FBUyxjQUFjLFFBQTRDO0FBQ3hFLFNBQU8sQ0FBQyxDQUFDLFVBQVUsdUJBQXVCLEtBQUssTUFBTTtBQUN2RDtBQVFPLFNBQVMsYUFBYUEsUUFBc0IsQ0FBQyxHQUFZO0FBQzlELE1BQUk7QUFDRixRQUFJQSxNQUFLLE1BQU8sUUFBTztBQUN2QixRQUFLLFdBQW1ELHNCQUF1QixRQUFPO0FBQ3RGLFVBQU0sUUFBUUEsTUFBSyxTQUFTO0FBQzVC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
