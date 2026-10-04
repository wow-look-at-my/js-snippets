// src/ui/data-table-math.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/ui/data-table-math.ts
function byKey(row, key) {
  return row[key];
}
function valueOf(row, col) {
  return col.value ? col.value(row) : byKey(row, col.key);
}
function textOf(row, col) {
  if (col.text) return col.text(row);
  const v = valueOf(row, col);
  return v == null ? "" : String(v);
}
function isBlank(v) {
  return v == null || v === "";
}
function compareValues(a, b) {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b) ? 0 : isBlank(a) ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), void 0, { numeric: true, sensitivity: "base" });
}
function sortRows(rows2, columns, sort) {
  if (!sort) return [...rows2];
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return [...rows2];
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows2.map((row, i) => ({ row, i, v: valueOf(row, col) })).sort((x, y) => {
    const xb = isBlank(x.v);
    const yb = isBlank(y.v);
    if (xb || yb) return xb && yb ? x.i - y.i : xb ? 1 : -1;
    const c = compareValues(x.v, y.v);
    return c !== 0 ? c * sign : x.i - y.i;
  }).map((d) => d.row);
}
function nextSortState(current, key) {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}
function haystackOf(row, columns, custom) {
  if (custom) return custom(row).toLowerCase();
  const parts = [];
  for (const col of columns) {
    if (col.searchable === false) continue;
    parts.push(textOf(row, col));
  }
  return parts.join(" ").toLowerCase();
}
function matchesQuery(haystack, query) {
  const terms = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => haystack.includes(t));
}
function selectRows(rows2, columns, filter = {}) {
  const query = filter.query ?? "";
  const hidden = filter.hidden ?? /* @__PURE__ */ new Map();
  const groups = filter.facets ?? [];
  const facetCounts = /* @__PURE__ */ new Map();
  for (const g of groups) facetCounts.set(g.key, /* @__PURE__ */ new Map());
  const shown = [];
  for (const row of rows2 ?? []) {
    let excluded = false;
    for (const g of groups) {
      const bucket = g.of(row);
      if (bucket == null || bucket === "") continue;
      const counts = facetCounts.get(g.key);
      counts?.set(bucket, (counts.get(bucket) ?? 0) + 1);
      if (hidden.get(g.key)?.has(bucket)) excluded = true;
    }
    if (excluded) continue;
    if (query.trim() !== "" && !matchesQuery(haystackOf(row, columns, filter.searchText), query)) continue;
    shown.push(row);
  }
  return { shown, facetCounts, total: rows2?.length ?? 0 };
}
function isFiltering(filter = {}) {
  if (String(filter.query ?? "").trim() !== "") return true;
  for (const set of filter.hidden?.values() ?? []) {
    if (set.size > 0) return true;
  }
  return false;
}
function toStoredTableFilter(state) {
  const hidden = {};
  for (const [group, set] of state.hidden ?? []) {
    if (set.size > 0) hidden[group] = [...set].sort();
  }
  return { query: state.query ?? "", hidden, sort: state.sort ?? null };
}
function hiddenFromStored(stored) {
  const out = /* @__PURE__ */ new Map();
  for (const [group, values] of Object.entries(stored.hidden)) out.set(group, new Set(values));
  return out;
}
function parseStoredTableFilter(raw) {
  const empty = { query: "", hidden: {}, sort: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return empty;
    const sort = v.sort && typeof v.sort === "object" && typeof v.sort.key === "string" && (v.sort.dir === "asc" || v.sort.dir === "desc") ? { key: v.sort.key, dir: v.sort.dir } : null;
    const hidden = {};
    if (v.hidden && typeof v.hidden === "object") {
      for (const [group, values] of Object.entries(v.hidden)) {
        if (Array.isArray(values)) hidden[group] = values.filter((x) => typeof x === "string");
      }
    }
    return { query: typeof v.query === "string" ? v.query : "", hidden, sort };
  } catch {
    return empty;
  }
}

// src/ui/data-table-math.test.ts
var COLUMNS = [
  { key: "id", label: "Run" },
  { key: "status", label: "Status" },
  { key: "ms", label: "Duration", value: (r) => r.ms, text: (r) => r.ms == null ? "" : `${r.ms}ms` }
];
var rows = [
  { id: "alpha", status: "success", ms: 900 },
  { id: "beta", status: "failure", ms: 90 },
  { id: "gamma", status: "skipped", ms: null }
];
test("valueOf falls back to the row property, textOf to the value", () => {
  assert.equal(valueOf(rows[0], COLUMNS[0]), "alpha");
  assert.equal(textOf(rows[0], COLUMNS[0]), "alpha");
  assert.equal(valueOf(rows[0], COLUMNS[2]), 900);
  assert.equal(textOf(rows[0], COLUMNS[2]), "900ms");
  assert.equal(textOf(rows[2], COLUMNS[2]), "");
});
test("compareValues orders numbers numerically, not lexically", () => {
  assert.ok(compareValues(9, 10) < 0, "9 must precede 10 (a string sort would not)");
  assert.ok(compareValues(10, 9) > 0);
  assert.equal(compareValues(5, 5), 0);
});
test("compareValues sorts nullish LAST in both directions", () => {
  assert.ok(compareValues(null, 1) > 0);
  assert.ok(compareValues(1, null) < 0);
  assert.ok(compareValues(void 0, "a") > 0);
  assert.ok(compareValues("", "a") > 0);
  assert.equal(compareValues(null, void 0), 0);
});
test("compareValues handles dates, booleans and numeric-aware strings", () => {
  assert.ok(compareValues(/* @__PURE__ */ new Date(1), /* @__PURE__ */ new Date(2)) < 0);
  assert.ok(compareValues(false, true) < 0);
  assert.ok(compareValues("run 9", "run 10") < 0, "numeric-aware collation");
});
test("sortRows is stable and leaves the input untouched", () => {
  const ties = [
    { id: "first", status: "x", ms: 1 },
    { id: "second", status: "x", ms: 1 },
    { id: "third", status: "x", ms: 1 }
  ];
  const asc = sortRows(ties, COLUMNS, { key: "ms", dir: "asc" });
  assert.deepEqual(asc.map((r) => r.id), ["first", "second", "third"]);
  const desc = sortRows(ties, COLUMNS, { key: "ms", dir: "desc" });
  assert.deepEqual(desc.map((r) => r.id), ["first", "second", "third"]);
  assert.deepEqual(ties.map((r) => r.id), ["first", "second", "third"], "input array is not mutated");
});
test("sortRows uses the column value, and parks nullish last both ways", () => {
  const asc = sortRows(rows, COLUMNS, { key: "ms", dir: "asc" });
  assert.deepEqual(asc.map((r) => r.id), ["beta", "alpha", "gamma"]);
  const desc = sortRows(rows, COLUMNS, { key: "ms", dir: "desc" });
  assert.deepEqual(desc.map((r) => r.id), ["alpha", "beta", "gamma"], "the null duration stays last");
});
test("sortRows passes rows through for a null or unknown sort", () => {
  assert.deepEqual(sortRows(rows, COLUMNS, null).map((r) => r.id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(
    sortRows(rows, COLUMNS, { key: "nope", dir: "asc" }).map((r) => r.id),
    ["alpha", "beta", "gamma"]
  );
});
test("nextSortState cycles asc -> desc -> unsorted", () => {
  const a = nextSortState(null, "ms");
  assert.deepEqual(a, { key: "ms", dir: "asc" });
  const b = nextSortState(a, "ms");
  assert.deepEqual(b, { key: "ms", dir: "desc" });
  assert.equal(nextSortState(b, "ms"), null);
  assert.deepEqual(nextSortState(b, "id"), { key: "id", dir: "asc" });
});
test("matchesQuery requires EVERY term (AND), not any", () => {
  assert.ok(matchesQuery("manager inbox dropped", "manager dropped"));
  assert.ok(!matchesQuery("manager inbox dropped", "manager missing"));
  assert.ok(matchesQuery("anything", ""), "an empty query matches everything");
  assert.ok(matchesQuery("anything", "   "));
});
test("selectRows filters by query across searchable columns", () => {
  const { shown, total } = selectRows(rows, COLUMNS, { query: "skip" });
  assert.deepEqual(shown.map((r) => r.id), ["gamma"]);
  assert.equal(total, 3);
});
test("selectRows honors searchable:false and a custom searchText", () => {
  const cols = [
    { key: "id", label: "Run", searchable: false },
    { key: "status", label: "Status" }
  ];
  assert.equal(selectRows(rows, cols, { query: "alpha" }).shown.length, 0, "the id column is excluded from search");
  const custom = selectRows(rows, cols, { query: "alpha", searchText: (r) => r.id });
  assert.deepEqual(custom.shown.map((r) => r.id), ["alpha"]);
});
test("selectRows hides facet buckets and counts across ALL rows", () => {
  const facets = [{ key: "status", of: (r) => r.status }];
  const hidden = /* @__PURE__ */ new Map([["status", /* @__PURE__ */ new Set(["skipped"])]]);
  const { shown, facetCounts } = selectRows(rows, COLUMNS, { facets, hidden });
  assert.deepEqual(shown.map((r) => r.id), ["alpha", "beta"]);
  assert.equal(facetCounts.get("status")?.get("skipped"), 1);
  assert.equal(facetCounts.get("status")?.get("success"), 1);
});
test("selectRows supports several independent facet groups", () => {
  const data = [
    { sev: "bad", fam: "run" },
    { sev: "bad", fam: "image" },
    { sev: "info", fam: "run" }
  ];
  const facets = [
    { key: "severity", of: (r) => r.sev },
    { key: "family", of: (r) => r.fam }
  ];
  const hidden = /* @__PURE__ */ new Map([["family", /* @__PURE__ */ new Set(["run"])]]);
  const { shown, facetCounts } = selectRows(data, [], { facets, hidden });
  assert.equal(shown.length, 1);
  assert.equal(shown[0]?.fam, "image");
  assert.equal(facetCounts.get("severity")?.get("bad"), 2);
  assert.equal(facetCounts.get("family")?.get("run"), 2);
});
test("selectRows ignores rows a group does not bucket", () => {
  const data = [{ k: "a" }, { k: "" }, {}];
  const facets = [{ key: "g", of: (r) => r.k }];
  const hidden = /* @__PURE__ */ new Map([["g", /* @__PURE__ */ new Set([""])]]);
  const { shown, facetCounts } = selectRows(data, [], { facets, hidden });
  assert.equal(shown.length, 3);
  assert.equal(facetCounts.get("g")?.size, 1);
});
test("selectRows preserves input order (sorting is a separate step)", () => {
  const { shown } = selectRows(rows, COLUMNS, {});
  assert.deepEqual(shown.map((r) => r.id), ["alpha", "beta", "gamma"]);
});
test("selectRows tolerates a missing row list", () => {
  assert.deepEqual(selectRows(null, COLUMNS, {}), { shown: [], facetCounts: /* @__PURE__ */ new Map(), total: 0 });
});
test("a host-filtered group is excluded from selection by the caller", () => {
  const facets = [{ key: "status", of: (r) => r.status }];
  const hidden = /* @__PURE__ */ new Map([["status", /* @__PURE__ */ new Set(["success"])]]);
  const withGroup = selectRows(rows, COLUMNS, { facets, hidden });
  const withoutGroup = selectRows(rows, COLUMNS, { facets: [], hidden });
  assert.equal(withGroup.shown.length, 2);
  assert.equal(withoutGroup.shown.length, 3, "no group declared = nothing dropped locally");
});
test("isFiltering ignores empty queries and empty hidden sets", () => {
  assert.ok(!isFiltering({}));
  assert.ok(!isFiltering({ query: "   " }));
  assert.ok(!isFiltering({ hidden: /* @__PURE__ */ new Map([["g", /* @__PURE__ */ new Set()]]) }), "an empty set is not a filter");
  assert.ok(isFiltering({ query: "x" }));
  assert.ok(isFiltering({ hidden: /* @__PURE__ */ new Map([["g", /* @__PURE__ */ new Set(["a"])]]) }));
});
test("toStoredTableFilter sorts buckets and drops empty groups", () => {
  const stored = toStoredTableFilter({
    query: "q",
    hidden: /* @__PURE__ */ new Map([
      ["status", /* @__PURE__ */ new Set(["skipped", "error"])],
      ["other", /* @__PURE__ */ new Set()]
    ]),
    sort: { key: "ms", dir: "desc" }
  });
  assert.deepEqual(stored, { query: "q", hidden: { status: ["error", "skipped"] }, sort: { key: "ms", dir: "desc" } });
});
test("round-tripping a stored filter preserves it", () => {
  const original = toStoredTableFilter({ query: "x", hidden: /* @__PURE__ */ new Map([["g", /* @__PURE__ */ new Set(["a", "b"])]]), sort: null });
  const parsed = parseStoredTableFilter(JSON.stringify(original));
  assert.deepEqual(parsed, original);
  assert.deepEqual(hiddenFromStored(parsed), /* @__PURE__ */ new Map([["g", /* @__PURE__ */ new Set(["a", "b"])]]));
});
test("parseStoredTableFilter degrades to no-filter on anything malformed", () => {
  const empty = { query: "", hidden: {}, sort: null };
  for (const raw of [null, void 0, "", "not json", "[]", '"str"', '{"hidden":5}', '{"sort":{"key":1}}']) {
    assert.deepEqual(parseStoredTableFilter(raw), empty, `raw=${String(raw)}`);
  }
  assert.equal(parseStoredTableFilter('{"sort":{"key":"ms","dir":"sideways"}}').sort, null);
  assert.deepEqual(parseStoredTableFilter('{"hidden":{"g":["a",2,null,"b"]}}').hidden, { g: ["a", "b"] });
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiZGF0YS10YWJsZS1tYXRoLnRlc3QudHMiLCAiZGF0YS10YWJsZS1tYXRoLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5pbXBvcnQgeyB0ZXN0IH0gZnJvbSAnbm9kZTp0ZXN0JztcblxuaW1wb3J0IHtcbiAgY29tcGFyZVZhbHVlcyxcbiAgaGlkZGVuRnJvbVN0b3JlZCxcbiAgaXNGaWx0ZXJpbmcsXG4gIG1hdGNoZXNRdWVyeSxcbiAgbmV4dFNvcnRTdGF0ZSxcbiAgcGFyc2VTdG9yZWRUYWJsZUZpbHRlcixcbiAgc2VsZWN0Um93cyxcbiAgc29ydFJvd3MsXG4gIHRleHRPZixcbiAgdG9TdG9yZWRUYWJsZUZpbHRlcixcbiAgdmFsdWVPZixcbiAgdHlwZSBEYXRhQ29sdW1uLFxufSBmcm9tICcuL2RhdGEtdGFibGUtbWF0aC50cyc7XG5cbmludGVyZmFjZSBSdW4gZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGlkOiBzdHJpbmc7XG4gIHN0YXR1czogc3RyaW5nO1xuICBtczogbnVtYmVyIHwgbnVsbDtcbn1cblxuY29uc3QgQ09MVU1OUzogRGF0YUNvbHVtbjxSdW4+W10gPSBbXG4gIHsga2V5OiAnaWQnLCBsYWJlbDogJ1J1bicgfSxcbiAgeyBrZXk6ICdzdGF0dXMnLCBsYWJlbDogJ1N0YXR1cycgfSxcbiAgeyBrZXk6ICdtcycsIGxhYmVsOiAnRHVyYXRpb24nLCB2YWx1ZTogKHIpID0+IHIubXMsIHRleHQ6IChyKSA9PiAoci5tcyA9PSBudWxsID8gJycgOiBgJHtyLm1zfW1zYCkgfSxcbl07XG5cbmNvbnN0IHJvd3M6IFJ1bltdID0gW1xuICB7IGlkOiAnYWxwaGEnLCBzdGF0dXM6ICdzdWNjZXNzJywgbXM6IDkwMCB9LFxuICB7IGlkOiAnYmV0YScsIHN0YXR1czogJ2ZhaWx1cmUnLCBtczogOTAgfSxcbiAgeyBpZDogJ2dhbW1hJywgc3RhdHVzOiAnc2tpcHBlZCcsIG1zOiBudWxsIH0sXG5dO1xuXG4vLyAtLSBDb2x1bW4gdmFsdWUvdGV4dCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgndmFsdWVPZiBmYWxscyBiYWNrIHRvIHRoZSByb3cgcHJvcGVydHksIHRleHRPZiB0byB0aGUgdmFsdWUnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbCh2YWx1ZU9mKHJvd3NbMF0hLCBDT0xVTU5TWzBdISksICdhbHBoYScpO1xuICBhc3NlcnQuZXF1YWwodGV4dE9mKHJvd3NbMF0hLCBDT0xVTU5TWzBdISksICdhbHBoYScpO1xuICAvLyBBIGNvbHVtbiB3aXRoIGJvdGg6IHNvcnRzIGJ5IG51bWJlciwgc2VhcmNoZXMgYnkgcmVuZGVyZWQgdGV4dC5cbiAgYXNzZXJ0LmVxdWFsKHZhbHVlT2Yocm93c1swXSEsIENPTFVNTlNbMl0hKSwgOTAwKTtcbiAgYXNzZXJ0LmVxdWFsKHRleHRPZihyb3dzWzBdISwgQ09MVU1OU1syXSEpLCAnOTAwbXMnKTtcbiAgYXNzZXJ0LmVxdWFsKHRleHRPZihyb3dzWzJdISwgQ09MVU1OU1syXSEpLCAnJyk7XG59KTtcblxuLy8gLS0gQ29tcGFyaXNvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ2NvbXBhcmVWYWx1ZXMgb3JkZXJzIG51bWJlcnMgbnVtZXJpY2FsbHksIG5vdCBsZXhpY2FsbHknLCAoKSA9PiB7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKDksIDEwKSA8IDAsICc5IG11c3QgcHJlY2VkZSAxMCAoYSBzdHJpbmcgc29ydCB3b3VsZCBub3QpJyk7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKDEwLCA5KSA+IDApO1xuICBhc3NlcnQuZXF1YWwoY29tcGFyZVZhbHVlcyg1LCA1KSwgMCk7XG59KTtcblxudGVzdCgnY29tcGFyZVZhbHVlcyBzb3J0cyBudWxsaXNoIExBU1QgaW4gYm90aCBkaXJlY3Rpb25zJywgKCkgPT4ge1xuICAvLyBBYnNlbmNlIGlzIG5vdCBhIHZhbHVlLiBCbGFua3MgbWFyY2hpbmcgdG8gdGhlIHRvcCBvZiBldmVyeSBkZXNjZW5kaW5nIHNvcnQgbWFrZXMgYSBtb3N0bHktZW1wdHkgY29sdW1uIHVzZWxlc3MuXG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKG51bGwsIDEpID4gMCk7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKDEsIG51bGwpIDwgMCk7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKHVuZGVmaW5lZCwgJ2EnKSA+IDApO1xuICBhc3NlcnQub2soY29tcGFyZVZhbHVlcygnJywgJ2EnKSA+IDApO1xuICBhc3NlcnQuZXF1YWwoY29tcGFyZVZhbHVlcyhudWxsLCB1bmRlZmluZWQpLCAwKTtcbn0pO1xuXG50ZXN0KCdjb21wYXJlVmFsdWVzIGhhbmRsZXMgZGF0ZXMsIGJvb2xlYW5zIGFuZCBudW1lcmljLWF3YXJlIHN0cmluZ3MnLCAoKSA9PiB7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKG5ldyBEYXRlKDEpLCBuZXcgRGF0ZSgyKSkgPCAwKTtcbiAgYXNzZXJ0Lm9rKGNvbXBhcmVWYWx1ZXMoZmFsc2UsIHRydWUpIDwgMCk7XG4gIGFzc2VydC5vayhjb21wYXJlVmFsdWVzKCdydW4gOScsICdydW4gMTAnKSA8IDAsICdudW1lcmljLWF3YXJlIGNvbGxhdGlvbicpO1xufSk7XG5cbi8vIC0tIFNvcnRpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdzb3J0Um93cyBpcyBzdGFibGUgYW5kIGxlYXZlcyB0aGUgaW5wdXQgdW50b3VjaGVkJywgKCkgPT4ge1xuICBjb25zdCB0aWVzOiBSdW5bXSA9IFtcbiAgICB7IGlkOiAnZmlyc3QnLCBzdGF0dXM6ICd4JywgbXM6IDEgfSxcbiAgICB7IGlkOiAnc2Vjb25kJywgc3RhdHVzOiAneCcsIG1zOiAxIH0sXG4gICAgeyBpZDogJ3RoaXJkJywgc3RhdHVzOiAneCcsIG1zOiAxIH0sXG4gIF07XG4gIGNvbnN0IGFzYyA9IHNvcnRSb3dzKHRpZXMsIENPTFVNTlMsIHsga2V5OiAnbXMnLCBkaXI6ICdhc2MnIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGFzYy5tYXAoKHIpID0+IHIuaWQpLCBbJ2ZpcnN0JywgJ3NlY29uZCcsICd0aGlyZCddKTtcbiAgLy8gRGVzY2VuZGluZyBtdXN0IG5vdCByZXZlcnNlIHRpZXMgZWl0aGVyIFx1MjAxNCBvbmx5IHRoZSBjb21wYXJlZCB2YWx1ZXMgZmxpcC5cbiAgY29uc3QgZGVzYyA9IHNvcnRSb3dzKHRpZXMsIENPTFVNTlMsIHsga2V5OiAnbXMnLCBkaXI6ICdkZXNjJyB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChkZXNjLm1hcCgocikgPT4gci5pZCksIFsnZmlyc3QnLCAnc2Vjb25kJywgJ3RoaXJkJ10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKHRpZXMubWFwKChyKSA9PiByLmlkKSwgWydmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnXSwgJ2lucHV0IGFycmF5IGlzIG5vdCBtdXRhdGVkJyk7XG59KTtcblxudGVzdCgnc29ydFJvd3MgdXNlcyB0aGUgY29sdW1uIHZhbHVlLCBhbmQgcGFya3MgbnVsbGlzaCBsYXN0IGJvdGggd2F5cycsICgpID0+IHtcbiAgY29uc3QgYXNjID0gc29ydFJvd3Mocm93cywgQ09MVU1OUywgeyBrZXk6ICdtcycsIGRpcjogJ2FzYycgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYXNjLm1hcCgocikgPT4gci5pZCksIFsnYmV0YScsICdhbHBoYScsICdnYW1tYSddKTtcbiAgY29uc3QgZGVzYyA9IHNvcnRSb3dzKHJvd3MsIENPTFVNTlMsIHsga2V5OiAnbXMnLCBkaXI6ICdkZXNjJyB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChkZXNjLm1hcCgocikgPT4gci5pZCksIFsnYWxwaGEnLCAnYmV0YScsICdnYW1tYSddLCAndGhlIG51bGwgZHVyYXRpb24gc3RheXMgbGFzdCcpO1xufSk7XG5cbnRlc3QoJ3NvcnRSb3dzIHBhc3NlcyByb3dzIHRocm91Z2ggZm9yIGEgbnVsbCBvciB1bmtub3duIHNvcnQnLCAoKSA9PiB7XG4gIGFzc2VydC5kZWVwRXF1YWwoc29ydFJvd3Mocm93cywgQ09MVU1OUywgbnVsbCkubWFwKChyKSA9PiByLmlkKSwgWydhbHBoYScsICdiZXRhJywgJ2dhbW1hJ10pO1xuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIHNvcnRSb3dzKHJvd3MsIENPTFVNTlMsIHsga2V5OiAnbm9wZScsIGRpcjogJ2FzYycgfSkubWFwKChyKSA9PiByLmlkKSxcbiAgICBbJ2FscGhhJywgJ2JldGEnLCAnZ2FtbWEnXSxcbiAgKTtcbn0pO1xuXG50ZXN0KCduZXh0U29ydFN0YXRlIGN5Y2xlcyBhc2MgLT4gZGVzYyAtPiB1bnNvcnRlZCcsICgpID0+IHtcbiAgY29uc3QgYSA9IG5leHRTb3J0U3RhdGUobnVsbCwgJ21zJyk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYSwgeyBrZXk6ICdtcycsIGRpcjogJ2FzYycgfSk7XG4gIGNvbnN0IGIgPSBuZXh0U29ydFN0YXRlKGEsICdtcycpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGIsIHsga2V5OiAnbXMnLCBkaXI6ICdkZXNjJyB9KTtcbiAgLy8gUmV0dXJuaW5nIHRvIHVuc29ydGVkIGlzIGhvdyB0aGUgcHJvZHVjZXIncyBvcmRlciAodXN1YWxseSBuZXdlc3QgZmlyc3QpIGJlY29tZXMgcmVhY2hhYmxlIGFnYWluLlxuICBhc3NlcnQuZXF1YWwobmV4dFNvcnRTdGF0ZShiLCAnbXMnKSwgbnVsbCk7XG4gIC8vIEEgZGlmZmVyZW50IGNvbHVtbiBzdGFydHMgaXRzIG93biBjeWNsZS5cbiAgYXNzZXJ0LmRlZXBFcXVhbChuZXh0U29ydFN0YXRlKGIsICdpZCcpLCB7IGtleTogJ2lkJywgZGlyOiAnYXNjJyB9KTtcbn0pO1xuXG4vLyAtLSBRdWVyeSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudGVzdCgnbWF0Y2hlc1F1ZXJ5IHJlcXVpcmVzIEVWRVJZIHRlcm0gKEFORCksIG5vdCBhbnknLCAoKSA9PiB7XG4gIGFzc2VydC5vayhtYXRjaGVzUXVlcnkoJ21hbmFnZXIgaW5ib3ggZHJvcHBlZCcsICdtYW5hZ2VyIGRyb3BwZWQnKSk7XG4gIGFzc2VydC5vayghbWF0Y2hlc1F1ZXJ5KCdtYW5hZ2VyIGluYm94IGRyb3BwZWQnLCAnbWFuYWdlciBtaXNzaW5nJykpO1xuICBhc3NlcnQub2sobWF0Y2hlc1F1ZXJ5KCdhbnl0aGluZycsICcnKSwgJ2FuIGVtcHR5IHF1ZXJ5IG1hdGNoZXMgZXZlcnl0aGluZycpO1xuICBhc3NlcnQub2sobWF0Y2hlc1F1ZXJ5KCdhbnl0aGluZycsICcgICAnKSk7XG59KTtcblxuLy8gLS0gU2VsZWN0aW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnRlc3QoJ3NlbGVjdFJvd3MgZmlsdGVycyBieSBxdWVyeSBhY3Jvc3Mgc2VhcmNoYWJsZSBjb2x1bW5zJywgKCkgPT4ge1xuICBjb25zdCB7IHNob3duLCB0b3RhbCB9ID0gc2VsZWN0Um93cyhyb3dzLCBDT0xVTU5TLCB7IHF1ZXJ5OiAnc2tpcCcgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc2hvd24ubWFwKChyKSA9PiByLmlkKSwgWydnYW1tYSddKTtcbiAgYXNzZXJ0LmVxdWFsKHRvdGFsLCAzKTtcbn0pO1xuXG50ZXN0KCdzZWxlY3RSb3dzIGhvbm9ycyBzZWFyY2hhYmxlOmZhbHNlIGFuZCBhIGN1c3RvbSBzZWFyY2hUZXh0JywgKCkgPT4ge1xuICBjb25zdCBjb2xzOiBEYXRhQ29sdW1uPFJ1bj5bXSA9IFtcbiAgICB7IGtleTogJ2lkJywgbGFiZWw6ICdSdW4nLCBzZWFyY2hhYmxlOiBmYWxzZSB9LFxuICAgIHsga2V5OiAnc3RhdHVzJywgbGFiZWw6ICdTdGF0dXMnIH0sXG4gIF07XG4gIGFzc2VydC5lcXVhbChzZWxlY3RSb3dzKHJvd3MsIGNvbHMsIHsgcXVlcnk6ICdhbHBoYScgfSkuc2hvd24ubGVuZ3RoLCAwLCAndGhlIGlkIGNvbHVtbiBpcyBleGNsdWRlZCBmcm9tIHNlYXJjaCcpO1xuXG4gIC8vIHNlYXJjaFRleHQgcmVwbGFjZXMgdGhlIGNvbHVtbiBjb25jYXRlbmF0aW9uIGVudGlyZWx5LlxuICBjb25zdCBjdXN0b20gPSBzZWxlY3RSb3dzKHJvd3MsIGNvbHMsIHsgcXVlcnk6ICdhbHBoYScsIHNlYXJjaFRleHQ6IChyKSA9PiByLmlkIH0pO1xuICBhc3NlcnQuZGVlcEVxdWFsKGN1c3RvbS5zaG93bi5tYXAoKHIpID0+IHIuaWQpLCBbJ2FscGhhJ10pO1xufSk7XG5cbnRlc3QoJ3NlbGVjdFJvd3MgaGlkZXMgZmFjZXQgYnVja2V0cyBhbmQgY291bnRzIGFjcm9zcyBBTEwgcm93cycsICgpID0+IHtcbiAgY29uc3QgZmFjZXRzID0gW3sga2V5OiAnc3RhdHVzJywgb2Y6IChyOiBSdW4pID0+IHIuc3RhdHVzIH1dO1xuICBjb25zdCBoaWRkZW4gPSBuZXcgTWFwKFtbJ3N0YXR1cycsIG5ldyBTZXQoWydza2lwcGVkJ10pXV0pO1xuICBjb25zdCB7IHNob3duLCBmYWNldENvdW50cyB9ID0gc2VsZWN0Um93cyhyb3dzLCBDT0xVTU5TLCB7IGZhY2V0cywgaGlkZGVuIH0pO1xuXG4gIGFzc2VydC5kZWVwRXF1YWwoc2hvd24ubWFwKChyKSA9PiByLmlkKSwgWydhbHBoYScsICdiZXRhJ10pO1xuICAvLyBUaGUgaGlkZGVuIGJ1Y2tldCBtdXN0IEtFRVAgaXRzIGNvdW50LlxuICBhc3NlcnQuZXF1YWwoZmFjZXRDb3VudHMuZ2V0KCdzdGF0dXMnKT8uZ2V0KCdza2lwcGVkJyksIDEpO1xuICBhc3NlcnQuZXF1YWwoZmFjZXRDb3VudHMuZ2V0KCdzdGF0dXMnKT8uZ2V0KCdzdWNjZXNzJyksIDEpO1xufSk7XG5cbnRlc3QoJ3NlbGVjdFJvd3Mgc3VwcG9ydHMgc2V2ZXJhbCBpbmRlcGVuZGVudCBmYWNldCBncm91cHMnLCAoKSA9PiB7XG4gIGludGVyZmFjZSBSb3cgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gICAgc2V2OiBzdHJpbmc7XG4gICAgZmFtOiBzdHJpbmc7XG4gIH1cbiAgY29uc3QgZGF0YTogUm93W10gPSBbXG4gICAgeyBzZXY6ICdiYWQnLCBmYW06ICdydW4nIH0sXG4gICAgeyBzZXY6ICdiYWQnLCBmYW06ICdpbWFnZScgfSxcbiAgICB7IHNldjogJ2luZm8nLCBmYW06ICdydW4nIH0sXG4gIF07XG4gIGNvbnN0IGZhY2V0cyA9IFtcbiAgICB7IGtleTogJ3NldmVyaXR5Jywgb2Y6IChyOiBSb3cpID0+IHIuc2V2IH0sXG4gICAgeyBrZXk6ICdmYW1pbHknLCBvZjogKHI6IFJvdykgPT4gci5mYW0gfSxcbiAgXTtcbiAgY29uc3QgaGlkZGVuID0gbmV3IE1hcChbWydmYW1pbHknLCBuZXcgU2V0KFsncnVuJ10pXV0pO1xuICBjb25zdCB7IHNob3duLCBmYWNldENvdW50cyB9ID0gc2VsZWN0Um93cyhkYXRhLCBbXSwgeyBmYWNldHMsIGhpZGRlbiB9KTtcblxuICBhc3NlcnQuZXF1YWwoc2hvd24ubGVuZ3RoLCAxKTtcbiAgYXNzZXJ0LmVxdWFsKHNob3duWzBdPy5mYW0sICdpbWFnZScpO1xuICAvLyBCb3RoIGdyb3VwcyBrZWVwIGZ1bGwgY291bnRzIGV2ZW4gdGhvdWdoIG9uZSBpcyBkb2luZyB0aGUgaGlkaW5nLlxuICBhc3NlcnQuZXF1YWwoZmFjZXRDb3VudHMuZ2V0KCdzZXZlcml0eScpPy5nZXQoJ2JhZCcpLCAyKTtcbiAgYXNzZXJ0LmVxdWFsKGZhY2V0Q291bnRzLmdldCgnZmFtaWx5Jyk/LmdldCgncnVuJyksIDIpO1xufSk7XG5cbnRlc3QoJ3NlbGVjdFJvd3MgaWdub3JlcyByb3dzIGEgZ3JvdXAgZG9lcyBub3QgYnVja2V0JywgKCkgPT4ge1xuICBjb25zdCBkYXRhID0gW3sgazogJ2EnIH0sIHsgazogJycgfSwge31dO1xuICBjb25zdCBmYWNldHMgPSBbeyBrZXk6ICdnJywgb2Y6IChyOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gci5rIGFzIHN0cmluZyB9XTtcbiAgY29uc3QgaGlkZGVuID0gbmV3IE1hcChbWydnJywgbmV3IFNldChbJyddKV1dKTtcbiAgY29uc3QgeyBzaG93biwgZmFjZXRDb3VudHMgfSA9IHNlbGVjdFJvd3MoZGF0YSwgW10sIHsgZmFjZXRzLCBoaWRkZW4gfSk7XG4gIC8vICcnIG1lYW5zIFwibm90IGluIHRoaXMgZ3JvdXBcIjogbmV2ZXIgY291bnRlZCwgbmV2ZXIgaGlkZGVuIGJ5IGl0LlxuICBhc3NlcnQuZXF1YWwoc2hvd24ubGVuZ3RoLCAzKTtcbiAgYXNzZXJ0LmVxdWFsKGZhY2V0Q291bnRzLmdldCgnZycpPy5zaXplLCAxKTtcbn0pO1xuXG50ZXN0KCdzZWxlY3RSb3dzIHByZXNlcnZlcyBpbnB1dCBvcmRlciAoc29ydGluZyBpcyBhIHNlcGFyYXRlIHN0ZXApJywgKCkgPT4ge1xuICBjb25zdCB7IHNob3duIH0gPSBzZWxlY3RSb3dzKHJvd3MsIENPTFVNTlMsIHt9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChzaG93bi5tYXAoKHIpID0+IHIuaWQpLCBbJ2FscGhhJywgJ2JldGEnLCAnZ2FtbWEnXSk7XG59KTtcblxudGVzdCgnc2VsZWN0Um93cyB0b2xlcmF0ZXMgYSBtaXNzaW5nIHJvdyBsaXN0JywgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKHNlbGVjdFJvd3MobnVsbCwgQ09MVU1OUywge30pLCB7IHNob3duOiBbXSwgZmFjZXRDb3VudHM6IG5ldyBNYXAoKSwgdG90YWw6IDAgfSk7XG59KTtcblxudGVzdCgnYSBob3N0LWZpbHRlcmVkIGdyb3VwIGlzIGV4Y2x1ZGVkIGZyb20gc2VsZWN0aW9uIGJ5IHRoZSBjYWxsZXInLCAoKSA9PiB7XG4gIC8vIDxkYXRhLXRhYmxlPiBkcm9wcyBGYWNldEdyb3VwLmxvY2FsID09PSBmYWxzZSBncm91cHMgYmVmb3JlIGNhbGxpbmcgc2VsZWN0Um93czogdGhlIGhvc3QgYWxyZWFkeSBhcHBsaWVkIHRoZW0uXG4gIGNvbnN0IGZhY2V0cyA9IFt7IGtleTogJ3N0YXR1cycsIG9mOiAocjogUnVuKSA9PiByLnN0YXR1cyB9XTtcbiAgY29uc3QgaGlkZGVuID0gbmV3IE1hcChbWydzdGF0dXMnLCBuZXcgU2V0KFsnc3VjY2VzcyddKV1dKTtcbiAgY29uc3Qgd2l0aEdyb3VwID0gc2VsZWN0Um93cyhyb3dzLCBDT0xVTU5TLCB7IGZhY2V0cywgaGlkZGVuIH0pO1xuICBjb25zdCB3aXRob3V0R3JvdXAgPSBzZWxlY3RSb3dzKHJvd3MsIENPTFVNTlMsIHsgZmFjZXRzOiBbXSwgaGlkZGVuIH0pO1xuICBhc3NlcnQuZXF1YWwod2l0aEdyb3VwLnNob3duLmxlbmd0aCwgMik7XG4gIGFzc2VydC5lcXVhbCh3aXRob3V0R3JvdXAuc2hvd24ubGVuZ3RoLCAzLCAnbm8gZ3JvdXAgZGVjbGFyZWQgPSBub3RoaW5nIGRyb3BwZWQgbG9jYWxseScpO1xufSk7XG5cbnRlc3QoJ2lzRmlsdGVyaW5nIGlnbm9yZXMgZW1wdHkgcXVlcmllcyBhbmQgZW1wdHkgaGlkZGVuIHNldHMnLCAoKSA9PiB7XG4gIGFzc2VydC5vayghaXNGaWx0ZXJpbmcoe30pKTtcbiAgYXNzZXJ0Lm9rKCFpc0ZpbHRlcmluZyh7IHF1ZXJ5OiAnICAgJyB9KSk7XG4gIGFzc2VydC5vayghaXNGaWx0ZXJpbmcoeyBoaWRkZW46IG5ldyBNYXAoW1snZycsIG5ldyBTZXQoKV1dKSB9KSwgJ2FuIGVtcHR5IHNldCBpcyBub3QgYSBmaWx0ZXInKTtcbiAgYXNzZXJ0Lm9rKGlzRmlsdGVyaW5nKHsgcXVlcnk6ICd4JyB9KSk7XG4gIGFzc2VydC5vayhpc0ZpbHRlcmluZyh7IGhpZGRlbjogbmV3IE1hcChbWydnJywgbmV3IFNldChbJ2EnXSldXSkgfSkpO1xufSk7XG5cbi8vIC0tIFN0b3JlZCBmaWx0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCd0b1N0b3JlZFRhYmxlRmlsdGVyIHNvcnRzIGJ1Y2tldHMgYW5kIGRyb3BzIGVtcHR5IGdyb3VwcycsICgpID0+IHtcbiAgY29uc3Qgc3RvcmVkID0gdG9TdG9yZWRUYWJsZUZpbHRlcih7XG4gICAgcXVlcnk6ICdxJyxcbiAgICBoaWRkZW46IG5ldyBNYXAoW1xuICAgICAgWydzdGF0dXMnLCBuZXcgU2V0KFsnc2tpcHBlZCcsICdlcnJvciddKV0sXG4gICAgICBbJ290aGVyJywgbmV3IFNldCgpXSxcbiAgICBdKSxcbiAgICBzb3J0OiB7IGtleTogJ21zJywgZGlyOiAnZGVzYycgfSxcbiAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoc3RvcmVkLCB7IHF1ZXJ5OiAncScsIGhpZGRlbjogeyBzdGF0dXM6IFsnZXJyb3InLCAnc2tpcHBlZCddIH0sIHNvcnQ6IHsga2V5OiAnbXMnLCBkaXI6ICdkZXNjJyB9IH0pO1xufSk7XG5cbnRlc3QoJ3JvdW5kLXRyaXBwaW5nIGEgc3RvcmVkIGZpbHRlciBwcmVzZXJ2ZXMgaXQnLCAoKSA9PiB7XG4gIGNvbnN0IG9yaWdpbmFsID0gdG9TdG9yZWRUYWJsZUZpbHRlcih7IHF1ZXJ5OiAneCcsIGhpZGRlbjogbmV3IE1hcChbWydnJywgbmV3IFNldChbJ2EnLCAnYiddKV1dKSwgc29ydDogbnVsbCB9KTtcbiAgY29uc3QgcGFyc2VkID0gcGFyc2VTdG9yZWRUYWJsZUZpbHRlcihKU09OLnN0cmluZ2lmeShvcmlnaW5hbCkpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHBhcnNlZCwgb3JpZ2luYWwpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGhpZGRlbkZyb21TdG9yZWQocGFyc2VkKSwgbmV3IE1hcChbWydnJywgbmV3IFNldChbJ2EnLCAnYiddKV1dKSk7XG59KTtcblxudGVzdCgncGFyc2VTdG9yZWRUYWJsZUZpbHRlciBkZWdyYWRlcyB0byBuby1maWx0ZXIgb24gYW55dGhpbmcgbWFsZm9ybWVkJywgKCkgPT4ge1xuICBjb25zdCBlbXB0eSA9IHsgcXVlcnk6ICcnLCBoaWRkZW46IHt9LCBzb3J0OiBudWxsIH07XG4gIC8vIEEgY29ycnVwdCBvciBzdGFsZSB2YWx1ZSBtdXN0IG5ldmVyIGxlYXZlIGEgdGFibGUgc2lsZW50bHkgaGlkaW5nIHJvd3MuXG4gIGZvciAoY29uc3QgcmF3IG9mIFtudWxsLCB1bmRlZmluZWQsICcnLCAnbm90IGpzb24nLCAnW10nLCAnXCJzdHJcIicsICd7XCJoaWRkZW5cIjo1fScsICd7XCJzb3J0XCI6e1wia2V5XCI6MX19J10pIHtcbiAgICBhc3NlcnQuZGVlcEVxdWFsKHBhcnNlU3RvcmVkVGFibGVGaWx0ZXIocmF3KSwgZW1wdHksIGByYXc9JHtTdHJpbmcocmF3KX1gKTtcbiAgfVxuICAvLyBBIGJhZCBkaXJlY3Rpb24gaXMgZHJvcHBlZCByYXRoZXIgdGhhbiB0cnVzdGVkLlxuICBhc3NlcnQuZXF1YWwocGFyc2VTdG9yZWRUYWJsZUZpbHRlcigne1wic29ydFwiOntcImtleVwiOlwibXNcIixcImRpclwiOlwic2lkZXdheXNcIn19Jykuc29ydCwgbnVsbCk7XG4gIC8vIE5vbi1zdHJpbmcgYnVja2V0IGVudHJpZXMgYXJlIGZpbHRlcmVkIG91dCwgdGhlIHJlc3Qgc3Vydml2ZXMuXG4gIGFzc2VydC5kZWVwRXF1YWwocGFyc2VTdG9yZWRUYWJsZUZpbHRlcigne1wiaGlkZGVuXCI6e1wiZ1wiOltcImFcIiwyLG51bGwsXCJiXCJdfX0nKS5oaWRkZW4sIHsgZzogWydhJywgJ2InXSB9KTtcbn0pO1xuIiwgIi8qKiBUaGUgcHVyZSBoYWxmIG9mIDxkYXRhLXRhYmxlPjogY29sdW1uIHJlc29sdXRpb24sIHNvcnRpbmcsIGZhY2V0aW5nIGFuZCBmaWx0ZXIgc2VsZWN0aW9uLiAqL1xuXG4vKiogT25lIHJvdyBpcyBhbnkgb2JqZWN0IHRoZSBjb25zdW1lciBoYW5kcyBvdmVyOyBjb2x1bW5zIHJlYWQgaXQuICovXG5leHBvcnQgdHlwZSBEYXRhUm93ID0gb2JqZWN0O1xuXG4vKiogUmVhZHMgYHJvd1trZXldYCB3aXRob3V0IGRlbWFuZGluZyBhbiBpbmRleCBzaWduYXR1cmUgb2YgdGhlIGNhbGxlci4gKi9cbmZ1bmN0aW9uIGJ5S2V5KHJvdzogRGF0YVJvdywga2V5OiBzdHJpbmcpOiB1bmtub3duIHtcbiAgcmV0dXJuIChyb3cgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pW2tleV07XG59XG5cbi8qKiBTb3J0IGRpcmVjdGlvbiwgb3Igbm9uZS4gKi9cbmV4cG9ydCB0eXBlIFNvcnREaXIgPSAnYXNjJyB8ICdkZXNjJztcblxuLyoqIFRoZSBhY3RpdmUgc29ydDogd2hpY2ggY29sdW1uLCB3aGljaCB3YXkuIG51bGwgPSB0aGUgY29uc3VtZXIncyBvcmRlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU29ydFN0YXRlIHtcbiAga2V5OiBzdHJpbmc7XG4gIGRpcjogU29ydERpcjtcbn1cblxuLyoqIEEgY29sdW1uIGRlY2xhcmF0aW9uLiBga2V5YCBpZGVudGlmaWVzIGl0IChhbmQsIGJ5IGRlZmF1bHQsIHJlYWRzIHRoZSByb3cnc1xuICogcHJvcGVydHkgb2YgdGhhdCBuYW1lKTsgZXZlcnl0aGluZyBlbHNlIGlzIG9wdGlvbmFsLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEYXRhQ29sdW1uPFJvdyBleHRlbmRzIERhdGFSb3cgPSBEYXRhUm93PiB7XG4gIGtleTogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICAvKiogU29ydC9jb21wYXJlIHZhbHVlLiBEZWZhdWx0OiBgcm93W2tleV1gLiAqL1xuICB2YWx1ZT86IChyb3c6IFJvdykgPT4gdW5rbm93bjtcbiAgLyoqIFNlYXJjaCB0ZXh0LiBEZWZhdWx0OiB0aGUgc3RyaW5nIGZvcm0gb2YgYHZhbHVlYC4gKi9cbiAgdGV4dD86IChyb3c6IFJvdykgPT4gc3RyaW5nO1xuICAvKiogU2V0IGZhbHNlIHRvIG1ha2UgdGhlIGhlYWRlciBpbmVydC4gRGVmYXVsdDogdHJ1ZS4gKi9cbiAgc29ydGFibGU/OiBib29sZWFuO1xuICAvKiogU2V0IGZhbHNlIHRvIGtlZXAgdGhpcyBjb2x1bW4gb3V0IG9mIHRoZSBmcmVlLXRleHQgcXVlcnkuIERlZmF1bHQ6IHRydWUuICovXG4gIHNlYXJjaGFibGU/OiBib29sZWFuO1xuICAvKiogQ29sdW1uIGFsaWdubWVudDsgJ2VuZCcgZm9yIG51bWVyaWNzLiAqL1xuICBhbGlnbj86ICdzdGFydCcgfCAnZW5kJztcbiAgLyoqIEV4dHJhIGNsYXNzIG9uIGV2ZXJ5IGNlbGwgaW4gdGhpcyBjb2x1bW4uICovXG4gIGNsYXNzTmFtZT86IHN0cmluZztcbn1cblxuLyoqIFJlYWRzIGEgY29sdW1uJ3Mgc29ydC9jb21wYXJlIHZhbHVlIG91dCBvZiBhIHJvdy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWx1ZU9mPFJvdyBleHRlbmRzIERhdGFSb3c+KHJvdzogUm93LCBjb2w6IERhdGFDb2x1bW48Um93Pik6IHVua25vd24ge1xuICByZXR1cm4gY29sLnZhbHVlID8gY29sLnZhbHVlKHJvdykgOiBieUtleShyb3csIGNvbC5rZXkpO1xufVxuXG4vKiogUmVhZHMgYSBjb2x1bW4ncyBzZWFyY2hhYmxlIHRleHQgb3V0IG9mIGEgcm93LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRleHRPZjxSb3cgZXh0ZW5kcyBEYXRhUm93Pihyb3c6IFJvdywgY29sOiBEYXRhQ29sdW1uPFJvdz4pOiBzdHJpbmcge1xuICBpZiAoY29sLnRleHQpIHJldHVybiBjb2wudGV4dChyb3cpO1xuICBjb25zdCB2ID0gdmFsdWVPZihyb3csIGNvbCk7XG4gIHJldHVybiB2ID09IG51bGwgPyAnJyA6IFN0cmluZyh2KTtcbn1cblxuLyogKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0JsYW5rKHY6IHVua25vd24pOiBib29sZWFuIHtcbiAgcmV0dXJuIHYgPT0gbnVsbCB8fCB2ID09PSAnJztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXBhcmVWYWx1ZXMoYTogdW5rbm93biwgYjogdW5rbm93bik6IG51bWJlciB7XG4gIGlmIChpc0JsYW5rKGEpIHx8IGlzQmxhbmsoYikpIHJldHVybiBpc0JsYW5rKGEpICYmIGlzQmxhbmsoYikgPyAwIDogaXNCbGFuayhhKSA/IDEgOiAtMTtcblxuICBpZiAodHlwZW9mIGEgPT09ICdudW1iZXInICYmIHR5cGVvZiBiID09PSAnbnVtYmVyJykgcmV0dXJuIGEgLSBiO1xuICBpZiAodHlwZW9mIGEgPT09ICdib29sZWFuJyAmJiB0eXBlb2YgYiA9PT0gJ2Jvb2xlYW4nKSByZXR1cm4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpO1xuICBpZiAoYSBpbnN0YW5jZW9mIERhdGUgJiYgYiBpbnN0YW5jZW9mIERhdGUpIHJldHVybiBhLmdldFRpbWUoKSAtIGIuZ2V0VGltZSgpO1xuICByZXR1cm4gU3RyaW5nKGEpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIpLCB1bmRlZmluZWQsIHsgbnVtZXJpYzogdHJ1ZSwgc2Vuc2l0aXZpdHk6ICdiYXNlJyB9KTtcbn1cblxuLyoqXG4gKiBTb3J0cyBhIENPUFkgb2Ygcm93cyBieSB0aGUgYWN0aXZlIHNvcnQuIFNUQUJMRTogZXF1YWwgcm93cyBrZWVwIHRoZVxuICogY29uc3VtZXIncyBvcmRlciwgd2hpY2ggaXMgd2hhdCBtYWtlcyBhIHNlY29uZGFyeSBvcmRlcmluZyAoYWxyZWFkeVxuICogbmV3ZXN0LWZpcnN0IGZyb20gdGhlIHNlcnZlciwgc2F5KSBzdXJ2aXZlIHNvcnRpbmcgYnkgYW5vdGhlciBjb2x1bW4uXG4gKiBBbiB1bmtub3duIHNvcnQga2V5LCBvciBhIG51bGwgc29ydCwgcmV0dXJucyB0aGUgcm93cyB1bnRvdWNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Um93czxSb3cgZXh0ZW5kcyBEYXRhUm93PihcbiAgcm93czogcmVhZG9ubHkgUm93W10sXG4gIGNvbHVtbnM6IHJlYWRvbmx5IERhdGFDb2x1bW48Um93PltdLFxuICBzb3J0OiBTb3J0U3RhdGUgfCBudWxsLFxuKTogUm93W10ge1xuICBpZiAoIXNvcnQpIHJldHVybiBbLi4ucm93c107XG4gIGNvbnN0IGNvbCA9IGNvbHVtbnMuZmluZCgoYykgPT4gYy5rZXkgPT09IHNvcnQua2V5KTtcbiAgaWYgKCFjb2wpIHJldHVybiBbLi4ucm93c107XG4gIGNvbnN0IHNpZ24gPSBzb3J0LmRpciA9PT0gJ2Rlc2MnID8gLTEgOiAxO1xuICAvLyBEZWNvcmF0ZSB3aXRoIHRoZSBpbmRleCBzbyB0aWVzIHJlc29sdmUgdG8gaW5wdXQgb3JkZXIgXHUyMDE0XG4gIC8vIEFycmF5LnByb3RvdHlwZS5zb3J0IGlzIHNwZWMtc3RhYmxlLCBidXQgdGhlIGluZGV4IGFsc28gbGV0cyB0aGVcbiAgLy8gZGVzY2VuZGluZyBjYXNlIGtlZXAgaW5wdXQgb3JkZXIgYW1vbmcgdGllcyBpbnN0ZWFkIG9mIHJldmVyc2luZyBpdC5cbiAgcmV0dXJuIHJvd3NcbiAgICAubWFwKChyb3csIGkpID0+ICh7IHJvdywgaSwgdjogdmFsdWVPZihyb3csIGNvbCkgfSkpXG4gICAgLnNvcnQoKHgsIHkpID0+IHtcbiAgICAgIC8vIEJsYW5rcyBhcmUgaGFuZGxlZCBPVVRTSURFIHRoZSBkaXJlY3Rpb24gc2lnbi5cbiAgICAgIGNvbnN0IHhiID0gaXNCbGFuayh4LnYpO1xuICAgICAgY29uc3QgeWIgPSBpc0JsYW5rKHkudik7XG4gICAgICBpZiAoeGIgfHwgeWIpIHJldHVybiB4YiAmJiB5YiA/IHguaSAtIHkuaSA6IHhiID8gMSA6IC0xO1xuICAgICAgY29uc3QgYyA9IGNvbXBhcmVWYWx1ZXMoeC52LCB5LnYpO1xuICAgICAgcmV0dXJuIGMgIT09IDAgPyBjICogc2lnbiA6IHguaSAtIHkuaTtcbiAgICB9KVxuICAgIC5tYXAoKGQpID0+IGQucm93KTtcbn1cblxuLyoqIFRoZSBoZWFkZXItY2xpY2sgY3ljbGU6IHVuc29ydGVkIFx1MjE5MiBhc2NlbmRpbmcgXHUyMTkyIGRlc2NlbmRpbmcgXHUyMTkyIHVuc29ydGVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5leHRTb3J0U3RhdGUoY3VycmVudDogU29ydFN0YXRlIHwgbnVsbCwga2V5OiBzdHJpbmcpOiBTb3J0U3RhdGUgfCBudWxsIHtcbiAgaWYgKCFjdXJyZW50IHx8IGN1cnJlbnQua2V5ICE9PSBrZXkpIHJldHVybiB7IGtleSwgZGlyOiAnYXNjJyB9O1xuICBpZiAoY3VycmVudC5kaXIgPT09ICdhc2MnKSByZXR1cm4geyBrZXksIGRpcjogJ2Rlc2MnIH07XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogT25lIGdyb3VwIG9mIGZhY2V0IGNoaXBzOiBhIG5hbWVkIHdheSBvZiBidWNrZXRpbmcgcm93cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmFjZXRHcm91cFNwZWM8Um93IGV4dGVuZHMgRGF0YVJvdyA9IERhdGFSb3c+IHtcbiAga2V5OiBzdHJpbmc7XG4gIG9mOiAocm93OiBSb3cpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBIaWRkZW4gYnVja2V0cywgcGVyIGZhY2V0IGdyb3VwLiAqL1xuZXhwb3J0IHR5cGUgSGlkZGVuRmFjZXRzID0gUmVhZG9ubHlNYXA8c3RyaW5nLCBSZWFkb25seVNldDxzdHJpbmc+PjtcblxuLyoqIFRoZSBmaWx0ZXIgaW5wdXRzIGEgc2VsZWN0aW9uIGlzIGNvbXB1dGVkIGZyb20uICovXG5leHBvcnQgaW50ZXJmYWNlIFRhYmxlRmlsdGVyPFJvdyBleHRlbmRzIERhdGFSb3cgPSBEYXRhUm93PiB7XG4gIHF1ZXJ5Pzogc3RyaW5nO1xuICBoaWRkZW4/OiBIaWRkZW5GYWNldHM7XG4gIGZhY2V0cz86IHJlYWRvbmx5IEZhY2V0R3JvdXBTcGVjPFJvdz5bXTtcbiAgLyoqIE92ZXJyaWRlcyB3aGF0IHRoZSBxdWVyeSBzZWFyY2hlcy4gRGVmYXVsdDogZXZlcnkgc2VhcmNoYWJsZSBjb2x1bW4ncyB0ZXh0LiAqL1xuICBzZWFyY2hUZXh0PzogKHJvdzogUm93KSA9PiBzdHJpbmc7XG59XG5cbi8qKiBXaGF0IGEgc2VsZWN0aW9uIHByb2R1Y2VkLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZWxlY3Rpb248Um93IGV4dGVuZHMgRGF0YVJvdyA9IERhdGFSb3c+IHtcbiAgLyoqIFRoZSByb3dzIHRvIHJlbmRlciwgaW4gb3JkZXIuICovXG4gIHNob3duOiBSb3dbXTtcbiAgLyoqIFBlciBncm91cCwgdGhlIGNvdW50IHBlciBidWNrZXQgYWNyb3NzIEFMTCByb3dzIFx1MjAxNCBzZWUgc2VsZWN0Um93cy4gKi9cbiAgZmFjZXRDb3VudHM6IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIG51bWJlcj4+O1xuICAvKiogSG93IG1hbnkgcm93cyB3ZXJlIHN1cHBsaWVkLiAqL1xuICB0b3RhbDogbnVtYmVyO1xufVxuXG4vKiogVGhlIGhheXN0YWNrIGEgcm93IGlzIHNlYXJjaGVkIGJ5LiAqL1xuZnVuY3Rpb24gaGF5c3RhY2tPZjxSb3cgZXh0ZW5kcyBEYXRhUm93Pihyb3c6IFJvdywgY29sdW1uczogcmVhZG9ubHkgRGF0YUNvbHVtbjxSb3c+W10sIGN1c3RvbT86IChyb3c6IFJvdykgPT4gc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGN1c3RvbSkgcmV0dXJuIGN1c3RvbShyb3cpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGNvbCBvZiBjb2x1bW5zKSB7XG4gICAgaWYgKGNvbC5zZWFyY2hhYmxlID09PSBmYWxzZSkgY29udGludWU7XG4gICAgcGFydHMucHVzaCh0ZXh0T2Yocm93LCBjb2wpKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbignICcpLnRvTG93ZXJDYXNlKCk7XG59XG5cbi8qKiBFdmVyeSB3aGl0ZXNwYWNlLXNlcGFyYXRlZCB0ZXJtIG11c3QgbWF0Y2ggc29tZXdoZXJlIChBTkQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoZXNRdWVyeShoYXlzdGFjazogc3RyaW5nLCBxdWVyeTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRlcm1zID0gU3RyaW5nKHF1ZXJ5ID8/ICcnKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgLnNwbGl0KC9cXHMrLylcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICByZXR1cm4gdGVybXMuZXZlcnkoKHQpID0+IGhheXN0YWNrLmluY2x1ZGVzKHQpKTtcbn1cblxuLyoqIEFwcGxpZXMgdGhlIGZpbHRlciBhbmQgY29tcHV0ZXMgdGhlIGZhY2V0IGNvdW50cy5cbiAqXG4gKiBGQUNFVCBDT1VOVFMgQ09WRVIgRVZFUlkgU1VQUExJRUQgUk9XLCBub3QgdGhlIHN1cnZpdmluZyBvbmVzOiBhIGNoaXAgcmVhZGluZyBcInNraXBwZWQgXHUwMEQ3MFwiIHRoZSBtb21lbnQgeW91IGhpZGUgc2tpcHBlZCByb3dzIGlzIHVzZWxlc3MsIGJlY2F1c2UgdGhlIG51bWJlciB5b3UgbmVlZCB0byBkZWNpZGUgd2hldGhlciB0byB1bmhpZGUgaXMgZXhhY3RseSB0aGUgb25lIHRoYXQgd2VudCB0byB6ZXJvLiBUaGUgcXVlcnkgbmFycm93cyB3aGF0IGlzIFNIT1dOOyBpdCBuZXZlciByZXdyaXRlcyB0aGUgY2hpcHMgb3V0IGZyb20gdW5kZXIgdGhlIHJlYWRlci5cbiAqXG4gKiBSb3cgb3JkZXIgaXMgUFJFU0VSVkVEIFx1MjAxNCBzb3J0aW5nIGlzIGEgc2VwYXJhdGUgc3RlcCAoc29ydFJvd3MpLCBzbyBhIHByb2R1Y2VyJ3MgbWVhbmluZ2Z1bCBkZWZhdWx0IG9yZGVyICh1c3VhbGx5IG5ld2VzdC1maXJzdCkgc3Vydml2ZXMgZmlsdGVyaW5nIHVudG91Y2hlZC5cbiAqXG4gKiBUaGUgY2FsbGVyJ3MgY2FwIChhIHNlcnZlci1zaWRlIGA/bWF4PWAsIHNheSkgaXMgdXBzdHJlYW0gb2YgYWxsIG9mIHRoaXMgYW5kIGlzIE5PVCB0aGlzIGNvbXBvbmVudCdzIHByb2JsZW0gdG8gc29sdmUgXHUyMDE0IGJ1dCBpdCBpcyB0aGUgY29uc3VtZXInczogaWYgdGhlIHByb2R1Y2VyIGNhcHMgYSBwYWdlIEJFRk9SRSBhcHBseWluZyB0aGUgc2FtZSBleGNsdXNpb25zLCBhIGJ1cnN0IG9mIHVud2FudGVkIHJvd3MgZmlsbHMgdGhlIHBhZ2UsIHRoaXMgZmlsdGVyIGVtcHRpZXMgaXQsIGFuZCB0aGUgdGFibGUgcmVwb3J0cyBcIm5vdGhpbmcgaGVyZVwiIHdoaWxlIHRoZSByb3dzLiBGaWx0ZXIgZmlyc3QsIGNhcCBzZWNvbmQsIG9uIHdoaWNoZXZlciBzaWRlIG93bnMgdGhlIGRhdGEuICovXG5leHBvcnQgZnVuY3Rpb24gc2VsZWN0Um93czxSb3cgZXh0ZW5kcyBEYXRhUm93PihcbiAgcm93czogcmVhZG9ubHkgUm93W10gfCBudWxsIHwgdW5kZWZpbmVkLFxuICBjb2x1bW5zOiByZWFkb25seSBEYXRhQ29sdW1uPFJvdz5bXSxcbiAgZmlsdGVyOiBUYWJsZUZpbHRlcjxSb3c+ID0ge30sXG4pOiBTZWxlY3Rpb248Um93PiB7XG4gIGNvbnN0IHF1ZXJ5ID0gZmlsdGVyLnF1ZXJ5ID8/ICcnO1xuICBjb25zdCBoaWRkZW4gPSBmaWx0ZXIuaGlkZGVuID8/IG5ldyBNYXA8c3RyaW5nLCBSZWFkb25seVNldDxzdHJpbmc+PigpO1xuICBjb25zdCBncm91cHMgPSBmaWx0ZXIuZmFjZXRzID8/IFtdO1xuXG4gIGNvbnN0IGZhY2V0Q291bnRzID0gbmV3IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIG51bWJlcj4+KCk7XG4gIGZvciAoY29uc3QgZyBvZiBncm91cHMpIGZhY2V0Q291bnRzLnNldChnLmtleSwgbmV3IE1hcCgpKTtcblxuICBjb25zdCBzaG93bjogUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cyA/PyBbXSkge1xuICAgIGxldCBleGNsdWRlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZyBvZiBncm91cHMpIHtcbiAgICAgIGNvbnN0IGJ1Y2tldCA9IGcub2Yocm93KTtcbiAgICAgIGlmIChidWNrZXQgPT0gbnVsbCB8fCBidWNrZXQgPT09ICcnKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGNvdW50cyA9IGZhY2V0Q291bnRzLmdldChnLmtleSk7XG4gICAgICBjb3VudHM/LnNldChidWNrZXQsIChjb3VudHMuZ2V0KGJ1Y2tldCkgPz8gMCkgKyAxKTtcbiAgICAgIGlmIChoaWRkZW4uZ2V0KGcua2V5KT8uaGFzKGJ1Y2tldCkpIGV4Y2x1ZGVkID0gdHJ1ZTtcbiAgICB9XG4gICAgLy8gQ291bnRpbmcgY29udGludWVzIGFjcm9zcyBldmVyeSBncm91cCBldmVuIG9uY2UgZXhjbHVkZWQgXHUyMDE0IGEgY2hpcCBtdXN0IHJlcG9ydCB3aGF0IGl0IGhpZGVzLlxuICAgIGlmIChleGNsdWRlZCkgY29udGludWU7XG4gICAgaWYgKHF1ZXJ5LnRyaW0oKSAhPT0gJycgJiYgIW1hdGNoZXNRdWVyeShoYXlzdGFja09mKHJvdywgY29sdW1ucywgZmlsdGVyLnNlYXJjaFRleHQpLCBxdWVyeSkpIGNvbnRpbnVlO1xuICAgIHNob3duLnB1c2gocm93KTtcbiAgfVxuICByZXR1cm4geyBzaG93biwgZmFjZXRDb3VudHMsIHRvdGFsOiByb3dzPy5sZW5ndGggPz8gMCB9O1xufVxuXG4vKiogSXMgYW55dGhpbmcgYWN0dWFsbHkgYmVpbmcgZmlsdGVyZWQgb3V0PyBEcml2ZXMgdGhlIFwiY2xlYXJcIiBhZmZvcmRhbmNlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRmlsdGVyaW5nPFJvdyBleHRlbmRzIERhdGFSb3c+KGZpbHRlcjogVGFibGVGaWx0ZXI8Um93PiA9IHt9KTogYm9vbGVhbiB7XG4gIGlmIChTdHJpbmcoZmlsdGVyLnF1ZXJ5ID8/ICcnKS50cmltKCkgIT09ICcnKSByZXR1cm4gdHJ1ZTtcbiAgZm9yIChjb25zdCBzZXQgb2YgZmlsdGVyLmhpZGRlbj8udmFsdWVzKCkgPz8gW10pIHtcbiAgICBpZiAoc2V0LnNpemUgPiAwKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBUaGUgcGVyc2lzdGVkL2VtaXR0ZWQgZmlsdGVyIHNoYXBlLiBQbGFpbiBKU09OOiBzZXRzIGJlY29tZSBzb3J0ZWQgYXJyYXlzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdG9yZWRUYWJsZUZpbHRlciB7XG4gIHF1ZXJ5OiBzdHJpbmc7XG4gIC8qKiBHcm91cCBrZXkgXHUyMTkyIHNvcnRlZCBoaWRkZW4gYnVja2V0cy4gKi9cbiAgaGlkZGVuOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT47XG4gIHNvcnQ6IFNvcnRTdGF0ZSB8IG51bGw7XG59XG5cbi8qKiBTZXJpYWxpemVzIHRoZSBsaXZlIGZpbHRlciBzdGF0ZSBpbnRvIHRoZSBzdG9yZWQgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gdG9TdG9yZWRUYWJsZUZpbHRlcihzdGF0ZToge1xuICBxdWVyeT86IHN0cmluZztcbiAgaGlkZGVuPzogSGlkZGVuRmFjZXRzO1xuICBzb3J0PzogU29ydFN0YXRlIHwgbnVsbDtcbn0pOiBTdG9yZWRUYWJsZUZpbHRlciB7XG4gIGNvbnN0IGhpZGRlbjogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge307XG4gIGZvciAoY29uc3QgW2dyb3VwLCBzZXRdIG9mIHN0YXRlLmhpZGRlbiA/PyBbXSkge1xuICAgIGlmIChzZXQuc2l6ZSA+IDApIGhpZGRlbltncm91cF0gPSBbLi4uc2V0XS5zb3J0KCk7XG4gIH1cbiAgcmV0dXJuIHsgcXVlcnk6IHN0YXRlLnF1ZXJ5ID8/ICcnLCBoaWRkZW4sIHNvcnQ6IHN0YXRlLnNvcnQgPz8gbnVsbCB9O1xufVxuXG4vKiogUmVidWlsZHMgdGhlIGxpdmUgaGlkZGVuLWZhY2V0IG1hcCBmcm9tIGEgc3RvcmVkIGZpbHRlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoaWRkZW5Gcm9tU3RvcmVkKHN0b3JlZDogU3RvcmVkVGFibGVGaWx0ZXIpOiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4ge1xuICBjb25zdCBvdXQgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG4gIGZvciAoY29uc3QgW2dyb3VwLCB2YWx1ZXNdIG9mIE9iamVjdC5lbnRyaWVzKHN0b3JlZC5oaWRkZW4pKSBvdXQuc2V0KGdyb3VwLCBuZXcgU2V0KHZhbHVlcykpO1xuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIFBhcnNlcyBhIHN0b3JlZCBmaWx0ZXIsIHRvbGVyYXRpbmcgYW55dGhpbmcuIEEgY29ycnVwdCBvciBzdGFsZVxuICogbG9jYWxTdG9yYWdlIHZhbHVlIG11c3QgZGVncmFkZSB0byBcIm5vIGZpbHRlclwiIFx1MjAxNCBuZXZlciB0aHJvdywgYW5kIG5ldmVyXG4gKiBsZWF2ZSBhIHRhYmxlIHNpbGVudGx5IGhpZGluZyByb3dzIGJlY2F1c2Ugb2YgYSBzaGFwZSBpdCBjYW4ndCByZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTdG9yZWRUYWJsZUZpbHRlcihyYXc6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBTdG9yZWRUYWJsZUZpbHRlciB7XG4gIGNvbnN0IGVtcHR5OiBTdG9yZWRUYWJsZUZpbHRlciA9IHsgcXVlcnk6ICcnLCBoaWRkZW46IHt9LCBzb3J0OiBudWxsIH07XG4gIGlmICghcmF3KSByZXR1cm4gZW1wdHk7XG4gIHRyeSB7XG4gICAgY29uc3QgdiA9IEpTT04ucGFyc2UocmF3KSBhcyBQYXJ0aWFsPFN0b3JlZFRhYmxlRmlsdGVyPiB8IG51bGw7XG4gICAgaWYgKCF2IHx8IHR5cGVvZiB2ICE9PSAnb2JqZWN0JykgcmV0dXJuIGVtcHR5O1xuICAgIGNvbnN0IHNvcnQgPVxuICAgICAgdi5zb3J0ICYmIHR5cGVvZiB2LnNvcnQgPT09ICdvYmplY3QnICYmIHR5cGVvZiB2LnNvcnQua2V5ID09PSAnc3RyaW5nJyAmJiAodi5zb3J0LmRpciA9PT0gJ2FzYycgfHwgdi5zb3J0LmRpciA9PT0gJ2Rlc2MnKVxuICAgICAgICA/IHsga2V5OiB2LnNvcnQua2V5LCBkaXI6IHYuc29ydC5kaXIgfVxuICAgICAgICA6IG51bGw7XG4gICAgY29uc3QgaGlkZGVuOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gPSB7fTtcbiAgICBpZiAodi5oaWRkZW4gJiYgdHlwZW9mIHYuaGlkZGVuID09PSAnb2JqZWN0Jykge1xuICAgICAgZm9yIChjb25zdCBbZ3JvdXAsIHZhbHVlc10gb2YgT2JqZWN0LmVudHJpZXModi5oaWRkZW4pKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlcykpIGhpZGRlbltncm91cF0gPSB2YWx1ZXMuZmlsdGVyKCh4KTogeCBpcyBzdHJpbmcgPT4gdHlwZW9mIHggPT09ICdzdHJpbmcnKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgcXVlcnk6IHR5cGVvZiB2LnF1ZXJ5ID09PSAnc3RyaW5nJyA/IHYucXVlcnkgOiAnJywgaGlkZGVuLCBzb3J0IH07XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBlbXB0eTtcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU8sWUFBWTtBQUNuQixTQUFTLFlBQVk7OztBQ0tyQixTQUFTLE1BQU0sS0FBYyxLQUFzQjtBQUNqRCxTQUFRLElBQWdDLEdBQUc7QUFDN0M7QUErQk8sU0FBUyxRQUE2QixLQUFVLEtBQStCO0FBQ3BGLFNBQU8sSUFBSSxRQUFRLElBQUksTUFBTSxHQUFHLElBQUksTUFBTSxLQUFLLElBQUksR0FBRztBQUN4RDtBQUdPLFNBQVMsT0FBNEIsS0FBVSxLQUE4QjtBQUNsRixNQUFJLElBQUksS0FBTSxRQUFPLElBQUksS0FBSyxHQUFHO0FBQ2pDLFFBQU0sSUFBSSxRQUFRLEtBQUssR0FBRztBQUMxQixTQUFPLEtBQUssT0FBTyxLQUFLLE9BQU8sQ0FBQztBQUNsQztBQUdPLFNBQVMsUUFBUSxHQUFxQjtBQUMzQyxTQUFPLEtBQUssUUFBUSxNQUFNO0FBQzVCO0FBRU8sU0FBUyxjQUFjLEdBQVksR0FBb0I7QUFDNUQsTUFBSSxRQUFRLENBQUMsS0FBSyxRQUFRLENBQUMsRUFBRyxRQUFPLFFBQVEsQ0FBQyxLQUFLLFFBQVEsQ0FBQyxJQUFJLElBQUksUUFBUSxDQUFD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
