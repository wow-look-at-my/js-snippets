// src/ui/markdown-parse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/ui/markdown-parse.ts
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
var SAFE_SCHEMES = /* @__PURE__ */ new Set(["http:", "https:", "mailto:"]);
function safeHref(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  return SAFE_SCHEMES.has(url.protocol) ? trimmed : null;
}
function parseMarkdown(source) {
  if (typeof source !== "string" || source.trim() === "") return null;
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  sanitizeTree(tree);
  return tree.children.length > 0 ? tree : null;
}
function sanitizeTree(tree) {
  const refusedDefinitions = /* @__PURE__ */ new Set();
  collectRefusedDefinitions(tree, refusedDefinitions);
  sanitizeChildren(tree, refusedDefinitions);
  return tree;
}
function collectRefusedDefinitions(node, refused) {
  if (node.type === "definition" && safeHref(node.url) === null) {
    refused.add(node.identifier);
  }
  const kids = node.children;
  if (kids) for (const child of kids) collectRefusedDefinitions(child, refused);
}
function sanitizeChildren(parent, refused) {
  const children = parent.children;
  if (!children) return;
  const out = [];
  for (const child of children) {
    sanitizeChildren(child, refused);
    switch (child.type) {
      case "html":
        out.push({ type: "text", value: child.value, position: child.position });
        break;
      case "link":
      case "linkReference": {
        const ok = child.type === "link" ? safeHref(child.url) !== null : !refused.has(child.identifier);
        if (ok) {
          if (child.type === "link") child.url = safeHref(child.url);
          out.push(child);
        } else {
          out.push(...child.children);
        }
        break;
      }
      case "image":
      case "imageReference": {
        const ok = child.type === "image" ? safeHref(child.url) !== null : !refused.has(child.identifier);
        if (ok) {
          if (child.type === "image") child.url = safeHref(child.url);
          out.push(child);
        } else if (child.alt) {
          out.push({ type: "text", value: child.alt, position: child.position });
        }
        break;
      }
      case "definition":
        out.push(child);
        break;
      default:
        out.push(child);
    }
  }
  parent.children = out;
}
function markdownToText(source) {
  const tree = parseMarkdown(source);
  if (tree === null) return "";
  const lines = [];
  const inline = (node) => {
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "break") return " ";
    if (node.type === "image") return node.alt ?? "";
    const kids = node.children;
    return kids ? kids.map(inline).join("") : "";
  };
  const walk = (node) => {
    switch (node.type) {
      case "code":
        lines.push(node.value);
        return;
      case "thematicBreak":
        return;
      case "paragraph":
      case "heading":
      case "tableCell":
        lines.push(inline(node));
        return;
      default: {
        const kids = node.children;
        if (kids) for (const child of kids) walk(child);
      }
    }
  };
  walk(tree);
  return lines.filter((line) => line.trim() !== "").join("\n");
}

// src/ui/markdown-parse.test.ts
var allNodes = (node) => {
  const kids = node.children ?? [];
  return [node, ...kids.flatMap(allNodes)];
};
var parse = (src) => {
  const tree = parseMarkdown(src);
  assert.ok(tree !== null, `expected a tree for ${JSON.stringify(src)}`);
  return tree;
};
var typesIn = (tree) => allNodes(tree).map((n) => n.type);
var textIn = (tree) => allNodes(tree).filter((n) => n.type === "text").map((n) => n.value).join("");
var linkish = (tree) => allNodes(tree).filter(
  (n) => n.type === "link" || n.type === "image" || n.type === "linkReference" || n.type === "imageReference"
);
test("absent or blank input parses to nothing", () => {
  assert.equal(parseMarkdown(null), null);
  assert.equal(parseMarkdown(void 0), null);
  assert.equal(parseMarkdown(""), null);
  assert.equal(parseMarkdown("   \n\n 	 "), null);
});
test("GFM is enabled: tables, task lists and strikethrough parse", () => {
  const table = parse("| a | b |\n| - | -: |\n| 1 | 2 |");
  const types = typesIn(table);
  assert.ok(types.includes("table"), types.join(","));
  assert.ok(types.includes("tableRow"));
  assert.ok(types.includes("tableCell"));
  const node = allNodes(table).find((n) => n.type === "table");
  assert.deepEqual(node.align, [null, "right"]);
  const items = allNodes(parse("- [x] done\n- [ ] todo")).filter(
    (n) => n.type === "listItem"
  );
  assert.deepEqual(
    items.map((i) => i.checked),
    [true, false]
  );
  assert.ok(typesIn(parse("~~gone~~")).includes("delete"));
});
test("nested lists nest, rather than flattening to one level", () => {
  const lists = allNodes(parse("- outer\n  - inner")).filter((n) => n.type === "list");
  assert.equal(lists.length, 2, "an outer and a nested inner list");
  const outerItem = lists[0].children[0];
  assert.ok(
    allNodes(outerItem).some((n) => n.type === "list"),
    "the inner list hangs off the outer item"
  );
});
test("headings keep their depth; offsetting is the renderer\u2019s job", () => {
  const headings = allNodes(parse("# One\n\n###### Six")).filter(
    (n) => n.type === "heading"
  );
  assert.deepEqual(
    headings.map((h) => h.depth),
    [1, 6]
  );
});
test("fenced code keeps its text and language verbatim", () => {
  const code = allNodes(parse("```js\nconst x = 1 < 2 && 3 > 2;\n```")).find(
    (n) => n.type === "code"
  );
  assert.equal(code.lang, "js");
  assert.equal(code.value, "const x = 1 < 2 && 3 > 2;");
});
test("markdownToText flattens to plain lines", () => {
  assert.equal(markdownToText("# Title\n\nsome **bold** text"), "Title\nsome bold text");
  assert.equal(markdownToText(""), "");
});
test("raw HTML never survives as markup \u2014 it becomes literal text", () => {
  const tree = parse(
    '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\ntext <b>b</b>'
  );
  assert.equal(
    typesIn(tree).filter((t) => t === "html").length,
    0,
    "no html node may survive sanitizeTree"
  );
  const text = textIn(tree);
  assert.match(text, /<img src=x onerror="alert\(1\)">/);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.match(text, /<b>/);
});
test("safeHref allows only http(s) and mailto", () => {
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHref("http://example.com/a"), "http://example.com/a");
  assert.equal(safeHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeHref("/docs/x"), "/docs/x");
  assert.equal(safeHref("../x?y=1#z"), "../x?y=1#z");
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "",
    "   ",
    null,
    void 0
  ]) {
    assert.equal(safeHref(bad), null, JSON.stringify(bad));
  }
});
test("safeHref is not fooled by case, padding, or embedded control characters", () => {
  for (const bad of [
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "	javascript:alert(1)",
    "java	script:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
    "JAVASCRIPT:alert(1)"
  ]) {
    assert.equal(safeHref(bad), null, JSON.stringify(bad));
  }
});
test("a refused link is unlinked, and its label survives as content", () => {
  for (const src of [
    "[click](javascript:alert(1))",
    "[click](data:text/html,x)",
    "[click](vbscript:msgbox)",
    "# [click](javascript:alert(1))",
    "> [click](javascript:alert(1))",
    "- [click](javascript:alert(1))",
    "| h |\n| - |\n| [click](javascript:alert(1)) |"
  ]) {
    const tree = parse(src);
    assert.equal(linkish(tree).length, 0, src);
    assert.match(textIn(tree), /click/, src);
  }
});
test("a refused image degrades to its alt text", () => {
  const tree = parse("![shot](javascript:alert(1))");
  assert.equal(linkish(tree).length, 0);
  assert.match(textIn(tree), /shot/);
});
test("reference-style links cannot smuggle a refused URL in via a definition", () => {
  const tree = parse("[click][bad]\n\n[bad]: javascript:alert(1)");
  assert.equal(linkish(tree).length, 0);
  assert.match(textIn(tree), /click/);
  const ok = parse("[click][good]\n\n[good]: https://example.com/x");
  assert.equal(linkish(ok).length, 1);
});
test("a safe link keeps its destination", () => {
  const link = allNodes(parse("[docs](https://example.com/x)")).find(
    (n) => n.type === "link"
  );
  assert.equal(link.url, "https://example.com/x");
  const wiki = allNodes(parse("[w](https://en.wikipedia.org/wiki/Foo_(bar))")).find(
    (n) => n.type === "link"
  );
  assert.equal(wiki.url, "https://en.wikipedia.org/wiki/Foo_(bar)");
});
test("sanitizeTree is idempotent and safe to re-run on a clean tree", () => {
  const tree = parse("[ok](https://e.example) and <b>raw</b>");
  const once = JSON.stringify(tree);
  assert.equal(JSON.stringify(sanitizeTree(tree)), once);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFya2Rvd24tcGFyc2UudGVzdC50cyIsICJtYXJrZG93bi1wYXJzZS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gVGVzdHMgZm9yIHRoZSBwdXJlIGhhbGYgb2YgdGhlIG1hcmtkb3duIHJlbmRlcmVyICh1aS9tYXJrZG93bi1wYXJzZS50cyk6IHRoZSBtZGFzdCB0cmVlIG1pY3JvbWFyayBwcm9kdWNlcy5cblxuaW1wb3J0IHsgdGVzdCB9IGZyb20gJ25vZGU6dGVzdCc7XG5pbXBvcnQgYXNzZXJ0IGZyb20gJ25vZGU6YXNzZXJ0L3N0cmljdCc7XG5cbmltcG9ydCB7XG4gIHBhcnNlTWFya2Rvd24sXG4gIHNhbml0aXplVHJlZSxcbiAgc2FmZUhyZWYsXG4gIG1hcmtkb3duVG9UZXh0LFxuICB0eXBlIE5vZGVzLFxuICB0eXBlIFJvb3QsXG59IGZyb20gJy4vbWFya2Rvd24tcGFyc2UudHMnO1xuXG4vKiogRXZlcnkgbm9kZSBpbiB0aGUgdHJlZSwgZGVwdGgtZmlyc3QgXHUyMDE0IHRoZSBzdXJmYWNlIGFueXRoaW5nIGNvdWxkIGhpZGUgaW4uICovXG5jb25zdCBhbGxOb2RlcyA9IChub2RlOiBOb2Rlcyk6IE5vZGVzW10gPT4ge1xuICBjb25zdCBraWRzID0gKG5vZGUgYXMgeyBjaGlsZHJlbj86IE5vZGVzW10gfSkuY2hpbGRyZW4gPz8gW107XG4gIHJldHVybiBbbm9kZSwgLi4ua2lkcy5mbGF0TWFwKGFsbE5vZGVzKV07XG59O1xuXG5jb25zdCBwYXJzZSA9IChzcmM6IHN0cmluZyk6IFJvb3QgPT4ge1xuICBjb25zdCB0cmVlID0gcGFyc2VNYXJrZG93bihzcmMpO1xuICBhc3NlcnQub2sodHJlZSAhPT0gbnVsbCwgYGV4cGVjdGVkIGEgdHJlZSBmb3IgJHtKU09OLnN0cmluZ2lmeShzcmMpfWApO1xuICByZXR1cm4gdHJlZTtcbn07XG5cbmNvbnN0IHR5cGVzSW4gPSAodHJlZTogUm9vdCk6IHN0cmluZ1tdID0+IGFsbE5vZGVzKHRyZWUgYXMgTm9kZXMpLm1hcCgobikgPT4gbi50eXBlKTtcblxuY29uc3QgdGV4dEluID0gKHRyZWU6IFJvb3QpOiBzdHJpbmcgPT5cbiAgYWxsTm9kZXModHJlZSBhcyBOb2RlcylcbiAgICAuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09ICd0ZXh0JylcbiAgICAubWFwKChuKSA9PiAobiBhcyB7IHZhbHVlOiBzdHJpbmcgfSkudmFsdWUpXG4gICAgLmpvaW4oJycpO1xuXG5jb25zdCBsaW5raXNoID0gKHRyZWU6IFJvb3QpOiBOb2Rlc1tdID0+XG4gIGFsbE5vZGVzKHRyZWUgYXMgTm9kZXMpLmZpbHRlcihcbiAgICAobikgPT5cbiAgICAgIG4udHlwZSA9PT0gJ2xpbmsnIHx8XG4gICAgICBuLnR5cGUgPT09ICdpbWFnZScgfHxcbiAgICAgIG4udHlwZSA9PT0gJ2xpbmtSZWZlcmVuY2UnIHx8XG4gICAgICBuLnR5cGUgPT09ICdpbWFnZVJlZmVyZW5jZScsXG4gICk7XG5cbi8vIC0tIHNoYXBlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50ZXN0KCdhYnNlbnQgb3IgYmxhbmsgaW5wdXQgcGFyc2VzIHRvIG5vdGhpbmcnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChwYXJzZU1hcmtkb3duKG51bGwpLCBudWxsKTtcbiAgYXNzZXJ0LmVxdWFsKHBhcnNlTWFya2Rvd24odW5kZWZpbmVkKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChwYXJzZU1hcmtkb3duKCcnKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChwYXJzZU1hcmtkb3duKCcgICBcXG5cXG4gXFx0ICcpLCBudWxsKTtcbn0pO1xuXG50ZXN0KCdHRk0gaXMgZW5hYmxlZDogdGFibGVzLCB0YXNrIGxpc3RzIGFuZCBzdHJpa2V0aHJvdWdoIHBhcnNlJywgKCkgPT4ge1xuICBjb25zdCB0YWJsZSA9IHBhcnNlKCd8IGEgfCBiIHxcXG58IC0gfCAtOiB8XFxufCAxIHwgMiB8Jyk7XG4gIGNvbnN0IHR5cGVzID0gdHlwZXNJbih0YWJsZSk7XG4gIGFzc2VydC5vayh0eXBlcy5pbmNsdWRlcygndGFibGUnKSwgdHlwZXMuam9pbignLCcpKTtcbiAgYXNzZXJ0Lm9rKHR5cGVzLmluY2x1ZGVzKCd0YWJsZVJvdycpKTtcbiAgYXNzZXJ0Lm9rKHR5cGVzLmluY2x1ZGVzKCd0YWJsZUNlbGwnKSk7XG4gIC8vIENvbHVtbiBhbGlnbm1lbnQgc3Vydml2ZXMgXHUyMDE0IGl0IGlzIHdoYXQgdGhlIHJlbmRlcmVyIHN0eWxlcyBjZWxscyBmcm9tLlxuICBjb25zdCBub2RlID0gYWxsTm9kZXModGFibGUgYXMgTm9kZXMpLmZpbmQoKG4pID0+IG4udHlwZSA9PT0gJ3RhYmxlJykhO1xuICBhc3NlcnQuZGVlcEVxdWFsKChub2RlIGFzIHsgYWxpZ24/OiB1bmtub3duIH0pLmFsaWduLCBbbnVsbCwgJ3JpZ2h0J10pO1xuXG4gIGNvbnN0IGl0ZW1zID0gYWxsTm9kZXMocGFyc2UoJy0gW3hdIGRvbmVcXG4tIFsgXSB0b2RvJykgYXMgTm9kZXMpLmZpbHRlcihcbiAgICAobikgPT4gbi50eXBlID09PSAnbGlzdEl0ZW0nLFxuICApO1xuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIGl0ZW1zLm1hcCgoaSkgPT4gKGkgYXMgeyBjaGVja2VkPzogYm9vbGVhbiB8IG51bGwgfSkuY2hlY2tlZCksXG4gICAgW3RydWUsIGZhbHNlXSxcbiAgKTtcblxuICBhc3NlcnQub2sodHlwZXNJbihwYXJzZSgnfn5nb25lfn4nKSkuaW5jbHVkZXMoJ2RlbGV0ZScpKTtcbn0pO1xuXG50ZXN0KCduZXN0ZWQgbGlzdHMgbmVzdCwgcmF0aGVyIHRoYW4gZmxhdHRlbmluZyB0byBvbmUgbGV2ZWwnLCAoKSA9PiB7XG4gIC8vIFRoZSBjb25jcmV0ZSBnYXAgdGhhdCBtYWRlIGEgaGFuZC1yb2xsZWQgcGFyc2VyIHRoZSB3cm9uZyBhbnN3ZXIgaGVyZS5cbiAgY29uc3QgbGlzdHMgPSBhbGxOb2RlcyhwYXJzZSgnLSBvdXRlclxcbiAgLSBpbm5lcicpIGFzIE5vZGVzKS5maWx0ZXIoKG4pID0+IG4udHlwZSA9PT0gJ2xpc3QnKTtcbiAgYXNzZXJ0LmVxdWFsKGxpc3RzLmxlbmd0aCwgMiwgJ2FuIG91dGVyIGFuZCBhIG5lc3RlZCBpbm5lciBsaXN0Jyk7XG4gIGNvbnN0IG91dGVySXRlbSA9IChsaXN0c1swXSBhcyB1bmtub3duIGFzIHsgY2hpbGRyZW46IE5vZGVzW10gfSkuY2hpbGRyZW5bMF07XG4gIGFzc2VydC5vayhcbiAgICBhbGxOb2RlcyhvdXRlckl0ZW0pLnNvbWUoKG4pID0+IG4udHlwZSA9PT0gJ2xpc3QnKSxcbiAgICAndGhlIGlubmVyIGxpc3QgaGFuZ3Mgb2ZmIHRoZSBvdXRlciBpdGVtJyxcbiAgKTtcbn0pO1xuXG50ZXN0KCdoZWFkaW5ncyBrZWVwIHRoZWlyIGRlcHRoOyBvZmZzZXR0aW5nIGlzIHRoZSByZW5kZXJlclx1MjAxOXMgam9iJywgKCkgPT4ge1xuICBjb25zdCBoZWFkaW5ncyA9IGFsbE5vZGVzKHBhcnNlKCcjIE9uZVxcblxcbiMjIyMjIyBTaXgnKSBhcyBOb2RlcykuZmlsdGVyKFxuICAgIChuKSA9PiBuLnR5cGUgPT09ICdoZWFkaW5nJyxcbiAgKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICBoZWFkaW5ncy5tYXAoKGgpID0+IChoIGFzIHsgZGVwdGg6IG51bWJlciB9KS5kZXB0aCksXG4gICAgWzEsIDZdLFxuICApO1xufSk7XG5cbnRlc3QoJ2ZlbmNlZCBjb2RlIGtlZXBzIGl0cyB0ZXh0IGFuZCBsYW5ndWFnZSB2ZXJiYXRpbScsICgpID0+IHtcbiAgY29uc3QgY29kZSA9IGFsbE5vZGVzKHBhcnNlKCdgYGBqc1xcbmNvbnN0IHggPSAxIDwgMiAmJiAzID4gMjtcXG5gYGAnKSBhcyBOb2RlcykuZmluZChcbiAgICAobikgPT4gbi50eXBlID09PSAnY29kZScsXG4gICkgYXMgeyBsYW5nPzogc3RyaW5nIHwgbnVsbDsgdmFsdWU6IHN0cmluZyB9O1xuICBhc3NlcnQuZXF1YWwoY29kZS5sYW5nLCAnanMnKTtcbiAgYXNzZXJ0LmVxdWFsKGNvZGUudmFsdWUsICdjb25zdCB4ID0gMSA8IDIgJiYgMyA+IDI7Jyk7XG59KTtcblxudGVzdCgnbWFya2Rvd25Ub1RleHQgZmxhdHRlbnMgdG8gcGxhaW4gbGluZXMnLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChtYXJrZG93blRvVGV4dCgnIyBUaXRsZVxcblxcbnNvbWUgKipib2xkKiogdGV4dCcpLCAnVGl0bGVcXG5zb21lIGJvbGQgdGV4dCcpO1xuICBhc3NlcnQuZXF1YWwobWFya2Rvd25Ub1RleHQoJycpLCAnJyk7XG59KTtcblxuLy8gLS0gdGhlIHNhZmV0eSBib3VuZGFyeSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gTWFya2Rvd24gaXMgdHlwaWNhbGx5IHdyaXR0ZW4gYnkgc29tZWJvZHkgb3RoZXIgdGhhbiB0aGUgcGFnZSdzIGF1dGhvci5cbi8vIFRoZXNlIGludmFyaWFudHMgYXJlIHdoYXQgbWFrZSByZW5kZXJpbmcgaXQgc2FmZSwgYW5kIHRoZXkgbXVzdCBub3Rcbi8vIHJlZ3Jlc3MuIEV2ZXJ5dGhpbmcgaGVyZSBpcyBhc3NlcnRlZCBvbiB0aGUgdHJlZSwgd2hpY2ggaXMgZXhhY3RseSB3aGF0XG4vLyB0aGUgRE9NIHdhbGtlciBjb25zdW1lcy5cblxudGVzdCgncmF3IEhUTUwgbmV2ZXIgc3Vydml2ZXMgYXMgbWFya3VwIFx1MjAxNCBpdCBiZWNvbWVzIGxpdGVyYWwgdGV4dCcsICgpID0+IHtcbiAgY29uc3QgdHJlZSA9IHBhcnNlKFxuICAgICc8aW1nIHNyYz14IG9uZXJyb3I9XCJhbGVydCgxKVwiPlxcblxcbjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD5cXG5cXG50ZXh0IDxiPmI8L2I+JyxcbiAgKTtcblxuICAvLyBDb21tb25NYXJrIHNheXMgdGhlc2UgQVJFIGh0bWwgbm9kZXM7IHRoZSB3aG9sZSBqb2IgaXMgdGhhdCBub25lIHJlYWNoXG4gIC8vIHRoZSByZW5kZXJlci5cbiAgYXNzZXJ0LmVxdWFsKFxuICAgIHR5cGVzSW4odHJlZSkuZmlsdGVyKCh0KSA9PiB0ID09PSAnaHRtbCcpLmxlbmd0aCxcbiAgICAwLFxuICAgICdubyBodG1sIG5vZGUgbWF5IHN1cnZpdmUgc2FuaXRpemVUcmVlJyxcbiAgKTtcblxuICAvLyBOb3RoaW5nIGlzIGRyb3BwZWQ6IHRoZSByZWFkZXIgc3RpbGwgc2VlcyB3aGF0IHRoZSBhdXRob3IgdHlwZWQuXG4gIGNvbnN0IHRleHQgPSB0ZXh0SW4odHJlZSk7XG4gIGFzc2VydC5tYXRjaCh0ZXh0LCAvPGltZyBzcmM9eCBvbmVycm9yPVwiYWxlcnRcXCgxXFwpXCI+Lyk7XG4gIGFzc2VydC5tYXRjaCh0ZXh0LCAvPHNjcmlwdD5hbGVydFxcKDFcXCk8XFwvc2NyaXB0Pi8pO1xuICBhc3NlcnQubWF0Y2godGV4dCwgLzxiPi8pO1xufSk7XG5cbnRlc3QoJ3NhZmVIcmVmIGFsbG93cyBvbmx5IGh0dHAocykgYW5kIG1haWx0bycsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKHNhZmVIcmVmKCdodHRwczovL2V4YW1wbGUuY29tL2EnKSwgJ2h0dHBzOi8vZXhhbXBsZS5jb20vYScpO1xuICBhc3NlcnQuZXF1YWwoc2FmZUhyZWYoJ2h0dHA6Ly9leGFtcGxlLmNvbS9hJyksICdodHRwOi8vZXhhbXBsZS5jb20vYScpO1xuICBhc3NlcnQuZXF1YWwoc2FmZUhyZWYoJ21haWx0bzphQGIuYycpLCAnbWFpbHRvOmFAYi5jJyk7XG4gIC8vIFJlbGF0aXZlIFVSTHMgaGF2ZSBubyBzY2hlbWUgb2YgdGhlaXIgb3duIGFuZCBpbmhlcml0IHRoZSBwYWdlJ3MuXG4gIGFzc2VydC5lcXVhbChzYWZlSHJlZignL2RvY3MveCcpLCAnL2RvY3MveCcpO1xuICBhc3NlcnQuZXF1YWwoc2FmZUhyZWYoJy4uL3g/eT0xI3onKSwgJy4uL3g/eT0xI3onKTtcblxuICBmb3IgKGNvbnN0IGJhZCBvZiBbXG4gICAgJ2phdmFzY3JpcHQ6YWxlcnQoMSknLFxuICAgICdkYXRhOnRleHQvaHRtbCw8c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+JyxcbiAgICAndmJzY3JpcHQ6bXNnYm94JyxcbiAgICAnZmlsZTovLy9ldGMvcGFzc3dkJyxcbiAgICAnJyxcbiAgICAnICAgJyxcbiAgICBudWxsLFxuICAgIHVuZGVmaW5lZCxcbiAgXSkge1xuICAgIGFzc2VydC5lcXVhbChzYWZlSHJlZihiYWQpLCBudWxsLCBKU09OLnN0cmluZ2lmeShiYWQpKTtcbiAgfVxufSk7XG5cbnRlc3QoJ3NhZmVIcmVmIGlzIG5vdCBmb29sZWQgYnkgY2FzZSwgcGFkZGluZywgb3IgZW1iZWRkZWQgY29udHJvbCBjaGFyYWN0ZXJzJywgKCkgPT4ge1xuICAvLyBUaGUgVVJMIHBhcnNlciBsb3dlcmNhc2VzIHRoZSBzY2hlbWUgYW5kIHN0cmlwcyBsZWFkaW5nIHdoaXRlc3BhY2UgYW5kXG4gIC8vIGVtYmVkZGVkIHRhYi9uZXdsaW5lL0NSIGJlZm9yZSBwYXJzaW5nIFx1MjAxNCBleGFjdGx5IGFzIGEgYnJvd3NlciB3b3VsZCB3aGVuXG4gIC8vIGl0IG5hdmlnYXRlcywgd2hpY2ggaXMgd2h5IGRldGVjdGlvbiBpcyBkZWxlZ2F0ZWQgdG8gaXQgcmF0aGVyIHRoYW4gdG8gYVxuICAvLyBzdHJpbmcgbWF0Y2guXG4gIGZvciAoY29uc3QgYmFkIG9mIFtcbiAgICAnSmFWYVNjUmlQdDphbGVydCgxKScsXG4gICAgJyAgamF2YXNjcmlwdDphbGVydCgxKScsXG4gICAgJ1xcdGphdmFzY3JpcHQ6YWxlcnQoMSknLFxuICAgICdqYXZhXFx0c2NyaXB0OmFsZXJ0KDEpJyxcbiAgICAnamF2YVxcbnNjcmlwdDphbGVydCgxKScsXG4gICAgJ2phdmFcXHJzY3JpcHQ6YWxlcnQoMSknLFxuICAgICdKQVZBU0NSSVBUOmFsZXJ0KDEpJyxcbiAgXSkge1xuICAgIGFzc2VydC5lcXVhbChzYWZlSHJlZihiYWQpLCBudWxsLCBKU09OLnN0cmluZ2lmeShiYWQpKTtcbiAgfVxufSk7XG5cbnRlc3QoJ2EgcmVmdXNlZCBsaW5rIGlzIHVubGlua2VkLCBhbmQgaXRzIGxhYmVsIHN1cnZpdmVzIGFzIGNvbnRlbnQnLCAoKSA9PiB7XG4gIGZvciAoY29uc3Qgc3JjIG9mIFtcbiAgICAnW2NsaWNrXShqYXZhc2NyaXB0OmFsZXJ0KDEpKScsXG4gICAgJ1tjbGlja10oZGF0YTp0ZXh0L2h0bWwseCknLFxuICAgICdbY2xpY2tdKHZic2NyaXB0Om1zZ2JveCknLFxuICAgICcjIFtjbGlja10oamF2YXNjcmlwdDphbGVydCgxKSknLFxuICAgICc+IFtjbGlja10oamF2YXNjcmlwdDphbGVydCgxKSknLFxuICAgICctIFtjbGlja10oamF2YXNjcmlwdDphbGVydCgxKSknLFxuICAgICd8IGggfFxcbnwgLSB8XFxufCBbY2xpY2tdKGphdmFzY3JpcHQ6YWxlcnQoMSkpIHwnLFxuICBdKSB7XG4gICAgY29uc3QgdHJlZSA9IHBhcnNlKHNyYyk7XG4gICAgYXNzZXJ0LmVxdWFsKGxpbmtpc2godHJlZSkubGVuZ3RoLCAwLCBzcmMpO1xuICAgIGFzc2VydC5tYXRjaCh0ZXh0SW4odHJlZSksIC9jbGljay8sIHNyYyk7XG4gIH1cbn0pO1xuXG50ZXN0KCdhIHJlZnVzZWQgaW1hZ2UgZGVncmFkZXMgdG8gaXRzIGFsdCB0ZXh0JywgKCkgPT4ge1xuICBjb25zdCB0cmVlID0gcGFyc2UoJyFbc2hvdF0oamF2YXNjcmlwdDphbGVydCgxKSknKTtcbiAgYXNzZXJ0LmVxdWFsKGxpbmtpc2godHJlZSkubGVuZ3RoLCAwKTtcbiAgYXNzZXJ0Lm1hdGNoKHRleHRJbih0cmVlKSwgL3Nob3QvKTtcbn0pO1xuXG50ZXN0KCdyZWZlcmVuY2Utc3R5bGUgbGlua3MgY2Fubm90IHNtdWdnbGUgYSByZWZ1c2VkIFVSTCBpbiB2aWEgYSBkZWZpbml0aW9uJywgKCkgPT4ge1xuICAvLyBUaGUgZGVzdGluYXRpb24gbGl2ZXMgaW4gYSBzZXBhcmF0ZSBub2RlIGZyb20gdGhlIGxpbmsuXG4gIGNvbnN0IHRyZWUgPSBwYXJzZSgnW2NsaWNrXVtiYWRdXFxuXFxuW2JhZF06IGphdmFzY3JpcHQ6YWxlcnQoMSknKTtcbiAgYXNzZXJ0LmVxdWFsKGxpbmtpc2godHJlZSkubGVuZ3RoLCAwKTtcbiAgYXNzZXJ0Lm1hdGNoKHRleHRJbih0cmVlKSwgL2NsaWNrLyk7XG5cbiAgLy8gVGhlIHNhZmUgdHdpbiBzdGlsbCByZXNvbHZlcywgc28gdGhlIGd1YXJkIGlzIG5vdCByZWZ1c2luZyBldmVyeXRoaW5nLlxuICBjb25zdCBvayA9IHBhcnNlKCdbY2xpY2tdW2dvb2RdXFxuXFxuW2dvb2RdOiBodHRwczovL2V4YW1wbGUuY29tL3gnKTtcbiAgYXNzZXJ0LmVxdWFsKGxpbmtpc2gob2spLmxlbmd0aCwgMSk7XG59KTtcblxudGVzdCgnYSBzYWZlIGxpbmsga2VlcHMgaXRzIGRlc3RpbmF0aW9uJywgKCkgPT4ge1xuICBjb25zdCBsaW5rID0gYWxsTm9kZXMocGFyc2UoJ1tkb2NzXShodHRwczovL2V4YW1wbGUuY29tL3gpJykgYXMgTm9kZXMpLmZpbmQoXG4gICAgKG4pID0+IG4udHlwZSA9PT0gJ2xpbmsnLFxuICApIGFzIHsgdXJsOiBzdHJpbmcgfTtcbiAgYXNzZXJ0LmVxdWFsKGxpbmsudXJsLCAnaHR0cHM6Ly9leGFtcGxlLmNvbS94Jyk7XG5cbiAgLy8gQSBkZXN0aW5hdGlvbiB3aXRoIGJhbGFuY2VkIHBhcmVucyBpcyBDb21tb25NYXJrJ3MgcHJvYmxlbSwgYW5kIGl0IGdldHNcbiAgLy8gaXQgcmlnaHQgXHUyMDE0IGEgbmFpdmUgcGFyc2VyIHRydW5jYXRlcyB0aGlzIGludG8gYSBXUk9ORyBsaW5rLlxuICBjb25zdCB3aWtpID0gYWxsTm9kZXMocGFyc2UoJ1t3XShodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9Gb29fKGJhcikpJykgYXMgTm9kZXMpLmZpbmQoXG4gICAgKG4pID0+IG4udHlwZSA9PT0gJ2xpbmsnLFxuICApIGFzIHsgdXJsOiBzdHJpbmcgfTtcbiAgYXNzZXJ0LmVxdWFsKHdpa2kudXJsLCAnaHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvRm9vXyhiYXIpJyk7XG59KTtcblxudGVzdCgnc2FuaXRpemVUcmVlIGlzIGlkZW1wb3RlbnQgYW5kIHNhZmUgdG8gcmUtcnVuIG9uIGEgY2xlYW4gdHJlZScsICgpID0+IHtcbiAgY29uc3QgdHJlZSA9IHBhcnNlKCdbb2tdKGh0dHBzOi8vZS5leGFtcGxlKSBhbmQgPGI+cmF3PC9iPicpO1xuICBjb25zdCBvbmNlID0gSlNPTi5zdHJpbmdpZnkodHJlZSk7XG4gIGFzc2VydC5lcXVhbChKU09OLnN0cmluZ2lmeShzYW5pdGl6ZVRyZWUodHJlZSkpLCBvbmNlKTtcbn0pO1xuIiwgIi8vIFB1cmUgbWFya2Rvd24gcGFyc2luZyBhbmQgdGhlIHNhZmV0eSB0cmFuc2Zvcm06IHNvdXJjZSB0ZXh0IC0+IGEgU0FGRSBtZGFzdCB0cmVlLlxuXG5pbXBvcnQgeyBmcm9tTWFya2Rvd24gfSBmcm9tICdtZGFzdC11dGlsLWZyb20tbWFya2Rvd24nO1xuaW1wb3J0IHsgZ2ZtIH0gZnJvbSAnbWljcm9tYXJrLWV4dGVuc2lvbi1nZm0nO1xuaW1wb3J0IHsgZ2ZtRnJvbU1hcmtkb3duIH0gZnJvbSAnbWRhc3QtdXRpbC1nZm0nO1xuaW1wb3J0IHR5cGUgeyBOb2RlcywgUm9vdCwgUm9vdENvbnRlbnQgfSBmcm9tICdtZGFzdCc7XG5cbmV4cG9ydCB0eXBlIHsgTm9kZXMsIFJvb3QsIFJvb3RDb250ZW50IH0gZnJvbSAnbWRhc3QnO1xuXG4vKiogU2NoZW1lcyBhIGxpbmsgbWF5IHVzZS4gRXZlcnl0aGluZyBlbHNlIGlzIHJlZnVzZWQgb3V0cmlnaHQuICovXG5jb25zdCBTQUZFX1NDSEVNRVMgPSBuZXcgU2V0KFsnaHR0cDonLCAnaHR0cHM6JywgJ21haWx0bzonXSk7XG5cbi8qKiBUaGUgaHJlZiB0byB1c2UgZm9yIGByYXdgLCBvciBudWxsIGlmIGl0IG11c3Qgbm90IGJlY29tZSBhIGxpbmsuICovXG5leHBvcnQgZnVuY3Rpb24gc2FmZUhyZWYocmF3OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRyaW1tZWQgPSByYXcudHJpbSgpO1xuICBpZiAodHJpbW1lZCA9PT0gJycpIHJldHVybiBudWxsO1xuICBsZXQgdXJsOiBVUkw7XG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTCh0cmltbWVkKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHRyaW1tZWQ7IC8vIHJlbGF0aXZlOiBubyBzY2hlbWUgb2YgaXRzIG93blxuICB9XG4gIHJldHVybiBTQUZFX1NDSEVNRVMuaGFzKHVybC5wcm90b2NvbCkgPyB0cmltbWVkIDogbnVsbDtcbn1cblxuLyoqXG4gKiBQYXJzZXMgbWFya2Rvd24gdG8gYW4gbWRhc3QgdHJlZSAoQ29tbW9uTWFyayArIEdGTSksIGFscmVhZHkgc2FuaXRpemVkIGJ5XG4gKiBzYW5pdGl6ZVRyZWUuIFJldHVybnMgbnVsbCBmb3IgaW5wdXQgdGhhdCBpcyBhYnNlbnQsIG9yIHdob3NlIHRyZWUgaGFzIG5vXG4gKiBjb250ZW50IC0tIHNvIGEgY2FsbGVyIGNhbiB0ZWxsIFwibm8gY29udGVudFwiIGZyb20gXCJjb250ZW50IHRoYXQgcmVuZGVyZWRcbiAqIHRvIG5vdGhpbmdcIiBhbmQgc2hvdyBpdHMgb3duIGVtcHR5IHN0YXRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VNYXJrZG93bihzb3VyY2U6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBSb290IHwgbnVsbCB7XG4gIGlmICh0eXBlb2Ygc291cmNlICE9PSAnc3RyaW5nJyB8fCBzb3VyY2UudHJpbSgpID09PSAnJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRyZWUgPSBmcm9tTWFya2Rvd24oc291cmNlLCB7XG4gICAgZXh0ZW5zaW9uczogW2dmbSgpXSxcbiAgICBtZGFzdEV4dGVuc2lvbnM6IFtnZm1Gcm9tTWFya2Rvd24oKV0sXG4gIH0pO1xuICBzYW5pdGl6ZVRyZWUodHJlZSk7XG4gIHJldHVybiB0cmVlLmNoaWxkcmVuLmxlbmd0aCA+IDAgPyB0cmVlIDogbnVsbDtcbn1cblxuLyoqIFJld3JpdGVzIGEgdHJlZSBpbiBwbGFjZSBzbyBub3RoaW5nIGluIGl0IGNhbiBleHByZXNzIG1hcmt1cCBvciBhbiB1bnNhZmVcbiAqIFVSTC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVRyZWUodHJlZTogUm9vdCk6IFJvb3Qge1xuICAvLyBBIGRlZmluaXRpb24gd2hvc2UgVVJMIGlzIHJlZnVzZWQgbXVzdCBub3QgYmUgcmVhY2hhYmxlIGJ5IHJlZmVyZW5jZS5cbiAgY29uc3QgcmVmdXNlZERlZmluaXRpb25zID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbGxlY3RSZWZ1c2VkRGVmaW5pdGlvbnModHJlZSwgcmVmdXNlZERlZmluaXRpb25zKTtcbiAgc2FuaXRpemVDaGlsZHJlbih0cmVlIGFzIHVua25vd24gYXMgeyBjaGlsZHJlbj86IFJvb3RDb250ZW50W10gfSwgcmVmdXNlZERlZmluaXRpb25zKTtcbiAgcmV0dXJuIHRyZWU7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RSZWZ1c2VkRGVmaW5pdGlvbnMobm9kZTogTm9kZXMsIHJlZnVzZWQ6IFNldDxzdHJpbmc+KTogdm9pZCB7XG4gIGlmIChub2RlLnR5cGUgPT09ICdkZWZpbml0aW9uJyAmJiBzYWZlSHJlZihub2RlLnVybCkgPT09IG51bGwpIHtcbiAgICByZWZ1c2VkLmFkZChub2RlLmlkZW50aWZpZXIpO1xuICB9XG4gIGNvbnN0IGtpZHMgPSAobm9kZSBhcyB7IGNoaWxkcmVuPzogTm9kZXNbXSB9KS5jaGlsZHJlbjtcbiAgaWYgKGtpZHMpIGZvciAoY29uc3QgY2hpbGQgb2Yga2lkcykgY29sbGVjdFJlZnVzZWREZWZpbml0aW9ucyhjaGlsZCwgcmVmdXNlZCk7XG59XG5cbmZ1bmN0aW9uIHNhbml0aXplQ2hpbGRyZW4ocGFyZW50OiB7IGNoaWxkcmVuPzogUm9vdENvbnRlbnRbXSB9LCByZWZ1c2VkOiBTZXQ8c3RyaW5nPik6IHZvaWQge1xuICBjb25zdCBjaGlsZHJlbiA9IHBhcmVudC5jaGlsZHJlbjtcbiAgaWYgKCFjaGlsZHJlbikgcmV0dXJuO1xuXG4gIGNvbnN0IG91dDogUm9vdENvbnRlbnRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgLy8gUmVjdXJzZSBmaXJzdCBzbyBhIHJlcGxhY2VtZW50IGluaGVyaXRzIGFscmVhZHktY2xlYW4gZGVzY2VuZGFudHMuXG4gICAgc2FuaXRpemVDaGlsZHJlbihjaGlsZCBhcyB7IGNoaWxkcmVuPzogUm9vdENvbnRlbnRbXSB9LCByZWZ1c2VkKTtcblxuICAgIHN3aXRjaCAoY2hpbGQudHlwZSkge1xuICAgICAgY2FzZSAnaHRtbCc6XG4gICAgICAgIC8vIFJhdyBIVE1MOiBrZWVwIHRoZSBjaGFyYWN0ZXJzLCBsb3NlIHRoZSBtYXJrdXAtbmVzcy5cbiAgICAgICAgb3V0LnB1c2goeyB0eXBlOiAndGV4dCcsIHZhbHVlOiBjaGlsZC52YWx1ZSwgcG9zaXRpb246IGNoaWxkLnBvc2l0aW9uIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnbGluayc6XG4gICAgICBjYXNlICdsaW5rUmVmZXJlbmNlJzoge1xuICAgICAgICBjb25zdCBvayA9XG4gICAgICAgICAgY2hpbGQudHlwZSA9PT0gJ2xpbmsnXG4gICAgICAgICAgICA/IHNhZmVIcmVmKGNoaWxkLnVybCkgIT09IG51bGxcbiAgICAgICAgICAgIDogIXJlZnVzZWQuaGFzKGNoaWxkLmlkZW50aWZpZXIpO1xuICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICBpZiAoY2hpbGQudHlwZSA9PT0gJ2xpbmsnKSBjaGlsZC51cmwgPSBzYWZlSHJlZihjaGlsZC51cmwpITtcbiAgICAgICAgICBvdXQucHVzaChjaGlsZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVW5saW5rOiB0aGUgbGFiZWwgc3Vydml2ZXMgYXMgb3JkaW5hcnkgY29udGVudC5cbiAgICAgICAgICBvdXQucHVzaCguLi4oY2hpbGQuY2hpbGRyZW4gYXMgUm9vdENvbnRlbnRbXSkpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlICdpbWFnZSc6XG4gICAgICBjYXNlICdpbWFnZVJlZmVyZW5jZSc6IHtcbiAgICAgICAgY29uc3Qgb2sgPVxuICAgICAgICAgIGNoaWxkLnR5cGUgPT09ICdpbWFnZSdcbiAgICAgICAgICAgID8gc2FmZUhyZWYoY2hpbGQudXJsKSAhPT0gbnVsbFxuICAgICAgICAgICAgOiAhcmVmdXNlZC5oYXMoY2hpbGQuaWRlbnRpZmllcik7XG4gICAgICAgIGlmIChvaykge1xuICAgICAgICAgIGlmIChjaGlsZC50eXBlID09PSAnaW1hZ2UnKSBjaGlsZC51cmwgPSBzYWZlSHJlZihjaGlsZC51cmwpITtcbiAgICAgICAgICBvdXQucHVzaChjaGlsZCk7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hpbGQuYWx0KSB7XG4gICAgICAgICAgb3V0LnB1c2goeyB0eXBlOiAndGV4dCcsIHZhbHVlOiBjaGlsZC5hbHQsIHBvc2l0aW9uOiBjaGlsZC5wb3NpdGlvbiB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSAnZGVmaW5pdGlvbic6XG4gICAgICAgIC8vIERlZmluaXRpb25zIHJlbmRlciBub3RoaW5nOyBhIHJlZnVzZWQgb25lIGlzIGFscmVhZHkgdW5yZWFjaGFibGUuXG4gICAgICAgIG91dC5wdXNoKGNoaWxkKTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIG91dC5wdXNoKGNoaWxkKTtcbiAgICB9XG4gIH1cbiAgcGFyZW50LmNoaWxkcmVuID0gb3V0O1xufVxuXG4vKipcbiAqIFBsYWluLXRleHQgZmxhdHRlbmluZyBmb3IgYSB0b29sdGlwIG9yIG9uZS1saW5lIHN1bW1hcnk6IG1hcmt1cCByZW1vdmVkLFxuICogYmxvY2stbGV2ZWwgbm9kZXMgbmV3bGluZS1zZXBhcmF0ZWQuIFB1cmUgLS0gbm8gRE9NLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFya2Rvd25Ub1RleHQoc291cmNlOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcbiAgY29uc3QgdHJlZSA9IHBhcnNlTWFya2Rvd24oc291cmNlKTtcbiAgaWYgKHRyZWUgPT09IG51bGwpIHJldHVybiAnJztcblxuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaW5saW5lID0gKG5vZGU6IE5vZGVzKTogc3RyaW5nID0+IHtcbiAgICBpZiAobm9kZS50eXBlID09PSAndGV4dCcgfHwgbm9kZS50eXBlID09PSAnaW5saW5lQ29kZScpIHJldHVybiBub2RlLnZhbHVlO1xuICAgIGlmIChub2RlLnR5cGUgPT09ICdicmVhaycpIHJldHVybiAnICc7XG4gICAgaWYgKG5vZGUudHlwZSA9PT0gJ2ltYWdlJykgcmV0dXJuIG5vZGUuYWx0ID8/ICcnO1xuICAgIGNvbnN0IGtpZHMgPSAobm9kZSBhcyB7IGNoaWxkcmVuPzogTm9kZXNbXSB9KS5jaGlsZHJlbjtcbiAgICByZXR1cm4ga2lkcyA/IGtpZHMubWFwKGlubGluZSkuam9pbignJykgOiAnJztcbiAgfTtcblxuICBjb25zdCB3YWxrID0gKG5vZGU6IE5vZGVzKTogdm9pZCA9PiB7XG4gICAgc3dpdGNoIChub2RlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2NvZGUnOlxuICAgICAgICBsaW5lcy5wdXNoKG5vZGUudmFsdWUpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICd0aGVtYXRpY0JyZWFrJzpcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAncGFyYWdyYXBoJzpcbiAgICAgIGNhc2UgJ2hlYWRpbmcnOlxuICAgICAgY2FzZSAndGFibGVDZWxsJzpcbiAgICAgICAgbGluZXMucHVzaChpbmxpbmUobm9kZSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIGNvbnN0IGtpZHMgPSAobm9kZSBhcyB7IGNoaWxkcmVuPzogTm9kZXNbXSB9KS5jaGlsZHJlbjtcbiAgICAgICAgaWYgKGtpZHMpIGZvciAoY29uc3QgY2hpbGQgb2Yga2lkcykgd2FsayhjaGlsZCk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIHdhbGsodHJlZSk7XG4gIHJldHVybiBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpICE9PSAnJykuam9pbignXFxuJyk7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBRUEsU0FBUyxZQUFZO0FBQ3JCLE9BQU8sWUFBWTs7O0FDRG5CLFNBQVMsb0JBQW9CO0FBQzdCLFNBQVMsV0FBVztBQUNwQixTQUFTLHVCQUF1QjtBQU1oQyxJQUFNLGVBQWUsb0JBQUksSUFBSSxDQUFDLFNBQVMsVUFBVSxTQUFTLENBQUM7QUFHcEQsU0FBUyxTQUFTLEtBQStDO0FBQ3RFLE1BQUksT0FBTyxRQUFRLFNBQVUsUUFBTztBQUNwQyxRQUFNLFVBQVUsSUFBSSxLQUFLO0FBQ3pCLE1BQUksWUFBWSxHQUFJLFFBQU87QUFDM0IsTUFBSTtBQUNKLE1BQUk7QUFDRixVQUFNLElBQUksSUFBSSxPQUFPO0FBQUEsRUFDdkIsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTyxhQUFhLElBQUksSUFBSSxRQUFRLElBQUksVUFBVTtBQUNwRDtBQVFPLFNBQVMsY0FBYyxRQUFnRDtBQUM1RSxNQUFJLE9BQU8sV0FBVyxZQUFZLE9BQU8sS0FBSyxNQUFNLEdBQUksUUFBTztBQUMvRCxRQUFNLE9BQU8sYUFBYSxRQUFRO0FBQUEsSUFDaEMsWUFBWSxDQUFDLElBQUksQ0FBQztBQUFBLElBQ2xCLGlCQUFpQixDQUFDLGdCQUFnQixDQUFDO0FBQUEsRUFDckMsQ0FBQztBQUNELGVBQWEsSUFBSTtBQUNqQixTQUFPLEtBQUssU0FBUyxTQUFT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
