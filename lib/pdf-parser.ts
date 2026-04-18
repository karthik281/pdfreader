"use client";

import type { Chapter, PageContent } from "@/types";

/**
 * Pages with fewer than this many extracted characters are treated as
 * image/table-heavy and rendered to a canvas for AI description.
 */
const IMAGE_SPARSE_THRESHOLD = 80;

/** Number of pages grouped into one section when no chapter headings are found. */
const DEFAULT_GROUP_SIZE = 10;

let pdfjsCache: typeof import("pdfjs-dist") | null = null;

/**
 * Dynamically load pdfjs only on the client to avoid SSR DOMMatrix errors.
 * Caches the instance so the worker is only initialised once per page load.
 * The worker is served from /public so there is no CDN version-mismatch risk.
 */
async function getPdfjs() {
  if (pdfjsCache) return pdfjsCache;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfjsCache = pdfjs;
  return pdfjs;
}

/**
 * Loads a PDF `File` and extracts per-page text and image snapshots.
 *
 * Pages with very little text (< IMAGE_SPARSE_THRESHOLD chars) are rendered
 * to a JPEG canvas snapshot that can be sent to a vision model for description.
 *
 * @param file       - The PDF file chosen by the user.
 * @param onProgress - Called after each page with `(currentPage, totalPages)`.
 * @returns Array of `PageContent` objects, one per page.
 */
export async function parsePDF(
  file: File,
  onProgress: (page: number, total: number) => void
): Promise<PageContent[]> {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pages: PageContent[] = [];

  for (let i = 1; i <= totalPages; i++) {
    onProgress(i, totalPages);
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // TextContent items can be TextItem (has .str) or TextMarkedContent (no .str)
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const hasImages = text.length < IMAGE_SPARSE_THRESHOLD;
    let imageDataUrl: string | undefined;

    if (hasImages) {
      imageDataUrl = await renderPageToDataUrl(page);
    }

    pages.push({ pageNumber: i, text, hasImages, imageDataUrl });
  }

  return pages;
}

/**
 * Renders a PDF page to a JPEG data URL at 1.5× scale.
 * Used for image-heavy pages that need AI vision description.
 */
async function renderPageToDataUrl(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>["getPage"]>>
): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  // JPEG at 80% quality keeps payloads manageable (~50–150 KB per page)
  return canvas.toDataURL("image/jpeg", 0.8);
}

// ---------------------------------------------------------------------------
// Chapter / section detection
// ---------------------------------------------------------------------------

/**
 * Patterns that identify lines as chapter/section headings.
 * Checked in order — first match wins.
 */
const CHAPTER_PATTERNS: RegExp[] = [
  // "Chapter 1", "Part II", "Section three", "Unit 4"
  /^(chapter|part|section|unit)\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
  // "1. Introduction" style
  /^(\d+)\.\s+[A-Z].{2,60}$/,
  // ALL-CAPS short lines (e.g. "INTRODUCTION", "BACKGROUND")
  /^[A-Z][A-Z\s]{4,50}$/,
];

/**
 * Returns `true` if a line of text looks like a chapter/section heading.
 * Exported for unit testing.
 *
 * @param line - A single line of text extracted from a PDF page.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return CHAPTER_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Groups a flat list of pages into chapters by detecting headings.
 * Falls back to fixed-size page groups if no headings are found.
 *
 * @param pages - Full list of parsed pages from `parsePDF`.
 * @returns Array of `Chapter` objects ready for the UI.
 */
export function detectChapters(pages: PageContent[]): Chapter[] {
  if (pages.length === 0) return [];

  let currentTitle = "Introduction";
  let currentStart = 1;
  let foundAnyHeading = false;
  const chapters: Chapter[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Only inspect the first few lines of each page for headings
    const lines = page.text.split(/(?<=[.!?])\s+|\n+/).slice(0, 6);

    for (const line of lines) {
      if (looksLikeHeading(line)) {
        if (i > 0) {
          chapters.push(makeChapter(currentTitle, currentStart, pages[i - 1].pageNumber, pages));
        }
        currentTitle = line.trim();
        currentStart = page.pageNumber;
        foundAnyHeading = true;
        break;
      }
    }
  }

  // Always push the final (or only) chapter
  chapters.push(makeChapter(currentTitle, currentStart, pages[pages.length - 1].pageNumber, pages));

  // Fallback: no headings found, or only one giant section — group by page count
  if (!foundAnyHeading || chapters.length === 1) {
    return groupByPages(pages, DEFAULT_GROUP_SIZE);
  }

  return chapters;
}

/**
 * Builds a `Chapter` object from a title, page range, and the full page list.
 * Exported for unit testing.
 */
export function makeChapter(
  title: string,
  startPage: number,
  endPage: number,
  allPages: PageContent[]
): Chapter {
  const chapterPages = allPages.filter(
    (p) => p.pageNumber >= startPage && p.pageNumber <= endPage
  );
  const content = chapterPages.map((p) => p.text).join("\n\n").trim();

  return {
    id: `ch-${startPage}`,
    title: title.length > 60 ? title.slice(0, 57) + "…" : title,
    pageStart: startPage,
    pageEnd: endPage,
    content,
    status: "idle",
  };
}

/**
 * Groups pages into fixed-size sections when no chapter headings are detected.
 * Exported for unit testing.
 *
 * @param pages     - Full page list.
 * @param groupSize - Number of pages per section.
 */
export function groupByPages(pages: PageContent[], groupSize: number): Chapter[] {
  if (pages.length === 0) return [];
  const chapters: Chapter[] = [];

  for (let i = 0; i < pages.length; i += groupSize) {
    const slice = pages.slice(i, i + groupSize);
    const startPage = slice[0].pageNumber;
    const endPage = slice[slice.length - 1].pageNumber;
    const content = slice.map((p) => p.text).join("\n\n").trim();
    const sectionNum = Math.floor(i / groupSize) + 1;

    chapters.push({
      id: `ch-${startPage}`,
      title: `Section ${sectionNum} (pages ${startPage}–${endPage})`,
      pageStart: startPage,
      pageEnd: endPage,
      content,
      status: "idle",
    });
  }

  return chapters;
}
