"use client";

import React from "react";
import { stripChangelogHeader } from "@/lib/file-helpers";

interface MarkdownRendererProps {
  content: string;
}

/**
 * Lightweight markdown renderer for previewing agent output files.
 * Handles: headings, bold, italic, inline code, code fences, unordered lists,
 * ordered lists, horizontal rules, links, paragraphs, and blockquotes.
 * Strips the changelog HTML comment from display.
 */
export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const displayContent = content ? stripChangelogHeader(content) : "";
  const html = renderMarkdown(displayContent);
  return (
    <div
      className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-li:text-gray-700 prose-code:rounded prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-pre:rounded-lg prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-a:text-indigo-600 prose-blockquote:border-l-2 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Simple markdown → HTML renderer ──────────────────────────────────────────

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlock: string[] = [];
  let codeLang = "";

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        result.push(renderCodeBlock(codeBlock.join("\n"), codeLang));
        codeBlock = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      result.push('<hr class="my-4 border-gray-200" />');
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      result.push(
        `<h${level} class="font-semibold text-gray-900 mt-6 mb-2 ${
          level === 1
            ? "text-xl"
            : level === 2
              ? "text-lg"
              : "text-base"
        }">${inlineMarkup(headingMatch[2])}</h${level}>`
      );
      i++;
      continue;
    }

    // Table (GFM pipe tables: header row + separator row)
    if (/^\s*\|/.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        bodyRows.push(parseTableRow(lines[i]));
        i++;
      }
      result.push(renderTable(headerCells, bodyRows));
      continue;
    }

    // List (unordered/ordered — nested, Chinese punctuation, task checkboxes)
    if (LIST_ITEM_RE.test(line)) {
      const block = renderListBlock(lines, i);
      result.push(block.html);
      i = block.nextIndex;
      continue;
    }

    // Blockquote
    if (/^>\s*/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s*/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s*/, ""));
        i++;
      }
      result.push(
        `<blockquote class="border-l-2 border-gray-300 pl-4 italic text-gray-600 my-2">${renderMarkdownInline(quoteLines.join("\n"))}</blockquote>`
      );
      continue;
    }

    // Empty line → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|```|[-*+]\s|\d+[\.、\)）]|^>\s|-{3,}|\*{3,}|_{3,})/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    // 流式输出可能停在半截标记；上面的分支未消费该行时，按正文安全渲染并推进，避免空转。
    if (paraLines.length === 0) {
      paraLines.push(line);
      i++;
    }
    result.push(
      `<p class="mb-3 leading-relaxed">${inlineMarkup(paraLines.join("\n"))}</p>`
    );
  }

  return result.join("\n");
}

function renderCodeBlock(code: string, lang: string): string {
  const escaped = escapeHtml(code);
  const safeLanguage = sanitizeCodeLanguage(lang);
  const languageClass = safeLanguage ? ` language-${safeLanguage}` : "";
  return `<pre class="rounded-lg bg-gray-900 p-4 my-3 overflow-x-auto"><code class="text-sm text-gray-100${languageClass}">${escaped}</code></pre>`;
}

// ─── Table parsing ─────────────────────────────────────────────────────────────

/** 表格分隔行：`| --- | :---: | ---: |`（支持左右对齐冒号）。 */
const TABLE_SEP_RE =
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

/** 解析一行 `| a | b |` 为单元格数组（去掉首尾管道与空白）。 */
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .map((cell) => inlineMarkup(cell));
}

function renderTable(headers: string[], bodyRows: string[][]): string {
  const th = headers
    .map((h) => `<th class="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-medium">${h}</th>`)
    .join("");
  const trs = bodyRows
    .map(
      (cells) =>
        `<tr>${cells
          .map((c) => `<td class="border border-gray-200 px-2 py-1.5">${c}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<div class="my-3 overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

// ─── List parsing ──────────────────────────────────────────────────────────────

/**
 * 列表项：无序符号（- * +）或序号（数字后接 . 、 ) ），
 * 中文顿号/右括号后允许无空格（如「1、方案一」）。允许前置缩进（嵌套）。
 */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[\.、\)）])\s*/;

interface ListEntry {
  text: string;
  sublist: ListBlock | null;
}

interface ListBlock {
  kind: "ul" | "ol";
  items: ListEntry[];
}

/**
 * 解析从 start 开始的连续列表行（含缩进），返回 HTML 与下一个未消费的行号。
 * 支持：嵌套列表（缩进层级）、中文标点序号、task checkbox（- [ ] / - [x]）。
 */
function renderListBlock(
  lines: string[],
  start: number
): { html: string; nextIndex: number } {
  const rows: { indent: number; text: string; kind: "ul" | "ol" }[] = [];
  let i = start;
  while (i < lines.length && LIST_ITEM_RE.test(lines[i])) {
    const raw = lines[i];
    const indent = (raw.match(/^\s*/) ?? [""])[0].length;
    const trimmed = raw.trim();
    rows.push({
      indent,
      text: trimmed.replace(LIST_ITEM_RE, ""),
      kind: /^\d+[\.、\)）]/.test(trimmed) ? "ol" : "ul",
    });
    i++;
  }

  // 缩进栈组装嵌套结构：栈内缩进严格递增。
  // 同缩进行留在当前块；更深的行挂到栈顶最后一条 entry 下开子块；更浅的出栈。
  const root: ListBlock = { kind: rows[0]?.kind ?? "ul", items: [] };
  const stack: { block: ListBlock; indent: number }[] = [
    { block: root, indent: rows[0]?.indent ?? -1 },
  ];
  for (const row of rows) {
    while (stack.length > 1 && row.indent < stack[stack.length - 1].indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    const entry: ListEntry = { text: row.text, sublist: null };
    if (row.indent > top.indent) {
      // 更深缩进：挂到栈顶最后一条 entry 下作为子列表
      const parentEntry = top.block.items[top.block.items.length - 1];
      parentEntry.sublist = { kind: row.kind, items: [] };
      stack.push({ block: parentEntry.sublist, indent: row.indent });
    }
    stack[stack.length - 1].block.items.push(entry);
  }

  return { html: renderListHtml(root), nextIndex: i };
}

/** 递归生成列表 HTML。nested 为 true 时附加子列表缩进。 */
function renderListHtml(block: ListBlock, nested = false): string {
  const tag = block.kind === "ol" ? "ol" : "ul";
  const listClass = nested ? "my-2 ml-4 space-y-1" : "my-2 space-y-1";
  const items = block.items.map((entry) => {
    const taskMatch = entry.text.match(/^\[([ xX])\]/);
    const isTask = !!taskMatch;
    const cleaned = entry.text.replace(/^\[([ xX])\]\s*/, "");
    // task 项不带符号；普通项按列表类型带 disc/decimal
    const liClass = isTask
      ? "ml-5"
      : block.kind === "ol"
        ? "ml-5 list-decimal"
        : "ml-5 list-disc";
    const content = isTask
      ? `${taskMatch![1] === " " ? '<span class="text-gray-400">☐</span>' : '<span class="text-green-600">☑</span>'} ${inlineMarkup(cleaned)}`
      : inlineMarkup(entry.text);
    const sub = entry.sublist ? renderListHtml(entry.sublist, true) : "";
    return `<li class="${liClass}">${content}${sub}</li>`;
  });
  return `<${tag} class="${listClass}">${items.join("")}</${tag}>`;
}

function renderMarkdownInline(md: string): string {
  const lines = md.split("\n");
  return lines.map((l) => inlineMarkup(l)).join("<br/>");
}

// ─── Inline markup ────────────────────────────────────────────────────────────

function inlineMarkup(text: string): string {
  const codeTokens: string[] = [];
  const codeProtected = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const token = `\u0000MD_CODE_${codeTokens.length}\u0000`;
    codeTokens.push(
      `<code class="rounded bg-gray-100 px-1 py-0.5 text-sm text-red-600">${escapeHtml(code)}</code>`,
    );
    return token;
  });

  const linkTokens: string[] = [];
  const unsafeLinkTokens: string[] = [];
  const linksProtected = codeProtected.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, url: string) => {
      const safeUrl = sanitizeLinkUrl(url);
      if (!safeUrl) {
        const token = `\u0000MD_UNSAFE_LINK_${unsafeLinkTokens.length}\u0000`;
        unsafeLinkTokens.push(escapeHtml(`[${label}](${url})`));
        return token;
      }

      const token = `\u0000MD_LINK_${linkTokens.length}\u0000`;
      linkTokens.push(
        `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline underline-offset-2 hover:text-indigo-800">${inlineMarkup(label)}</a>`,
      );
      return token;
    },
  );

  let result = escapeHtml(linksProtected);

  // 用占位 token 保护代码片段和链接，再解析其余行内语法。

  // Bold + Italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");

  result = result.replace(
    /\u0000MD_LINK_(\d+)\u0000/g,
    (_, index: string) => linkTokens[Number(index)] ?? "",
  );
  result = result.replace(
    /\u0000MD_UNSAFE_LINK_(\d+)\u0000/g,
    (_, index: string) => unsafeLinkTokens[Number(index)] ?? "",
  );
  result = result.replace(
    /\u0000MD_CODE_(\d+)\u0000/g,
    (_, index: string) => codeTokens[Number(index)] ?? "",
  );

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_LINK_PROTOCOL_RE = /^(?:https?:|mailto:)/i;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const UNSAFE_LINK_CHAR_RE = /[\s"'<>]/;
const SAFE_CODE_LANGUAGE_RE = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;

/** 只允许可在聊天中安全打开的链接协议，并拒绝控制字符绕过协议检查。 */
function sanitizeLinkUrl(url: string): string | null {
  const normalized = url.trim();
  if (
    !normalized ||
    CONTROL_CHAR_RE.test(normalized) ||
    UNSAFE_LINK_CHAR_RE.test(normalized) ||
    !SAFE_LINK_PROTOCOL_RE.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/** 语言名只用于 class token，拒绝空白、引号和其他属性注入字符。 */
function sanitizeCodeLanguage(language: string): string | null {
  const normalized = language.trim();
  return normalized && normalized.length <= 64 && SAFE_CODE_LANGUAGE_RE.test(normalized)
    ? normalized
    : null;
}
