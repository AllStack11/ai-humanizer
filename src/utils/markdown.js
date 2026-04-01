import MarkdownIt from "markdown-it";

const MARKDOWN = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPlainTextAsHtml(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, "https://local.invalid");
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:") {
      return trimmed.startsWith("//") ? "" : parsed.href.replace("https://local.invalid", "");
    }

    return "";
  } catch {
    return "";
  }
}

function stripUnsafeMarkdownLinks(text) {
  return String(text || "").replace(
    /\[([^\]]+?)\]\(((?:javascript|vbscript|data):[^\n]+)\)/gi,
    "$1"
  );
}

function createDocumentFragment(html) {
  if (typeof document === "undefined") return null;
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

function renderTableFallback(table) {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td")).map((cell) => (cell.textContent || "").trim())
    )
    .filter((cells) => cells.some(Boolean));

  if (!rows.length) return "";

  const headerCells = Array.from(rows[0] || []);
  const hasExplicitHeader = table.querySelector("thead th") != null || table.querySelector("tr th") != null;
  const dataRows = hasExplicitHeader ? rows.slice(1) : rows;
  const parts = [];

  if (hasExplicitHeader && headerCells.length) {
    const heading = headerCells
      .map((cell) => `<strong>${escapeHtml(cell)}</strong>`)
      .join(" | ");
    parts.push(`<p>${heading}</p>`);
  }

  if (dataRows.length) {
    const items = dataRows
      .map((cells) => {
        const line = cells
          .map((cell, index) => {
            const value = escapeHtml(cell);
            if (hasExplicitHeader && headerCells[index]) {
              return `<strong>${escapeHtml(headerCells[index])}:</strong> ${value}`;
            }
            return value;
          })
          .join("<br>");

        return line ? `<li><p>${line}</p></li>` : "";
      })
      .join("");

    if (items) parts.push(`<ul>${items}</ul>`);
  }

  if (!parts.length) {
    return rows
      .map((cells) => `<p>${cells.map((cell) => escapeHtml(cell)).join(" | ")}</p>`)
      .join("");
  }

  return parts.join("");
}

function normalizeRenderedHtml(rawHtml) {
  const template = createDocumentFragment(rawHtml);
  if (!template) return rawHtml;

  Array.from(template.content.querySelectorAll("a")).forEach((anchor) => {
    const safeHref = normalizeUrl(anchor.getAttribute("href"));
    if (!safeHref) {
      anchor.replaceWith(document.createTextNode(anchor.textContent || ""));
      return;
    }

    anchor.setAttribute("href", safeHref);
    if (safeHref.startsWith("http://") || safeHref.startsWith("https://")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  });

  Array.from(template.content.querySelectorAll("table")).forEach((table) => {
    const fallbackTemplate = document.createElement("template");
    fallbackTemplate.innerHTML = renderTableFallback(table);
    table.replaceWith(fallbackTemplate.content);
  });

  return template.innerHTML;
}

export function renderMarkdownToHtml(text) {
  let source = "";
  try {
    source = String(text || "");
  } catch {
    return "";
  }

  if (!source.trim()) return "";

  try {
    const normalized = stripUnsafeMarkdownLinks(
      source
        .replace(/\r\n/g, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
    );
    const rendered = MARKDOWN.render(normalized);
    return normalizeRenderedHtml(rendered);
  } catch {
    return renderPlainTextAsHtml(source);
  }
}
