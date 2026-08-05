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

    // Unordered list
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(
          `<li class="ml-5 list-disc">${inlineMarkup(lines[i].replace(/^[\s]*[-*+]\s+/, ""))}</li>`
        );
        i++;
      }
      result.push(
        `<ul class="my-2 space-y-1">${items.join("")}</ul>`
      );
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[\.\、]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[\.\、]\s+/.test(lines[i])) {
        items.push(
          `<li class="ml-5 list-decimal">${inlineMarkup(lines[i].replace(/^[\s]*\d+[\.\、]\s+/, ""))}</li>`
        );
        i++;
      }
      result.push(
        `<ol class="my-2 space-y-1">${items.join("")}</ol>`
      );
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
      !/^(#{1,6}\s|```|[-*+]\s|\d+[\.\、]\s|^>\s|-{3,}|\*{3,}|_{3,})/.test(lines[i])
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
