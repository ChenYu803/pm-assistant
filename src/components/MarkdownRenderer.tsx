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
    if (paraLines.length > 0) {
      result.push(
        `<p class="mb-3 leading-relaxed">${inlineMarkup(paraLines.join("\n"))}</p>`
      );
    }
  }

  return result.join("\n");
}

function renderCodeBlock(code: string, lang: string): string {
  const escaped = escapeHtml(code);
  return `<pre class="rounded-lg bg-gray-900 p-4 my-3 overflow-x-auto"><code class="text-sm text-gray-100">${escaped}</code></pre>`;
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
  let result = escapeHtml(text);

  // Inline code (backticks)
  result = result.replace(/`([^`]+)`/g, `<code class="rounded bg-gray-100 px-1 py-0.5 text-sm text-red-600">$1</code>`);

  // Bold + Italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline underline-offset-2 hover:text-indigo-800">$1</a>'
  );

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
