import { describe, expect, test } from "vitest";
import { renderMarkdownToHtml } from "./markdown.js";

describe("renderMarkdownToHtml", () => {
  test("renders headings and inline emphasis", () => {
    const html = renderMarkdownToHtml("## Heading\n\nThis has **bold** and *italic* text.");

    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  test("escapes HTML and keeps code blocks literal", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>\n\n```js\nconst x = \"<tag>\";\n```");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<pre><code class=\"language-js\">const x = \"&lt;tag&gt;\";");
  });

  test("renders common block markdown with horizontal rules and lists", () => {
    const html = renderMarkdownToHtml("# Stage 1\n\n---\n\n- first point\n- second point");

    expect(html).toContain("<h1>Stage 1</h1>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>first point</li>");
  });

  test("normalizes markdown tables into readable supported markup", () => {
    const html = renderMarkdownToHtml(
      "| Term | Meaning |\n| --- | --- |\n| **Vector Store / VectorDB** | Database storing embedded chunks |\n| **Embedding** | Text converted to vectors |"
    );

    expect(html).not.toContain("<table>");
    expect(html).toContain("<p><strong>Term</strong> | <strong>Meaning</strong></p>");
    expect(html).toContain("<strong>Term:</strong> Vector Store / VectorDB");
    expect(html).toContain("<strong>Meaning:</strong> Database storing embedded chunks");
  });

  test("keeps safe links and strips unsafe ones", () => {
    const html = renderMarkdownToHtml("[Docs](https://example.com)\n\n[Bad](javascript:alert(1))");

    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">Docs</a>");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain("<p>Bad</p>");
  });

  test("handles malformed llm markdown without leaking raw table syntax", () => {
    const html = renderMarkdownToHtml(
      "# Stage 1: RETRIEVAL\n\nWhat happens: Finding relevant information\n\n- Dense Retrieval\n- Sparse Retrieval\n\n| Term | Meaning |<br>|------|---------|<br>| **Top-K** | number of results |"
    );

    expect(html).toContain("<h1>Stage 1: RETRIEVAL</h1>");
    expect(html).toContain("<ul>");
    expect(html).not.toContain("|------|");
    expect(html).toContain("Top-K");
  });

  test("falls back safely when input coercion fails", () => {
    const badInput = {
      toString() {
        throw new Error("boom");
      },
    };

    expect(() => renderMarkdownToHtml(badInput)).not.toThrow();
    expect(renderMarkdownToHtml(badInput)).toBe("");
  });
});
