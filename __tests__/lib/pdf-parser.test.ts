import {
  looksLikeHeading,
  detectChapters,
  groupByPages,
  makeChapter,
} from "@/lib/pdf-parser";
import type { PageContent } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePage(pageNumber: number, text: string, hasImages = false): PageContent {
  return { pageNumber, text, hasImages };
}

// ---------------------------------------------------------------------------
// looksLikeHeading
// ---------------------------------------------------------------------------
describe("looksLikeHeading", () => {
  it("recognises 'Chapter N' patterns", () => {
    expect(looksLikeHeading("Chapter 1")).toBe(true);
    expect(looksLikeHeading("chapter two")).toBe(true);
    expect(looksLikeHeading("CHAPTER IV")).toBe(true);
  });

  it("recognises 'Part / Section / Unit' patterns", () => {
    expect(looksLikeHeading("Part 3")).toBe(true);
    expect(looksLikeHeading("Section five")).toBe(true);
    expect(looksLikeHeading("Unit 2")).toBe(true);
  });

  it("recognises numbered section headings", () => {
    expect(looksLikeHeading("1. Introduction")).toBe(true);
    expect(looksLikeHeading("4. Methodology")).toBe(true);
  });

  it("recognises ALL-CAPS short headings", () => {
    expect(looksLikeHeading("INTRODUCTION")).toBe(true);
    expect(looksLikeHeading("BACKGROUND")).toBe(true);
  });

  it("rejects normal body text", () => {
    expect(looksLikeHeading("This is a normal paragraph that continues.")).toBe(false);
    expect(looksLikeHeading("the quick brown fox jumps over the lazy dog.")).toBe(false);
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(looksLikeHeading("")).toBe(false);
    expect(looksLikeHeading("   ")).toBe(false);
  });

  it("rejects lines longer than 80 characters", () => {
    const longLine = "A".repeat(81);
    expect(looksLikeHeading(longLine)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// groupByPages
// ---------------------------------------------------------------------------
describe("groupByPages", () => {
  it("returns empty array for empty input", () => {
    expect(groupByPages([], 10)).toEqual([]);
  });

  it("creates one section when pages fit in a single group", () => {
    const pages = [makePage(1, "text1"), makePage(2, "text2")];
    const chapters = groupByPages(pages, 10);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].pageStart).toBe(1);
    expect(chapters[0].pageEnd).toBe(2);
  });

  it("creates multiple sections for large page counts", () => {
    const pages = Array.from({ length: 25 }, (_, i) => makePage(i + 1, `page ${i + 1}`));
    const chapters = groupByPages(pages, 10);
    expect(chapters).toHaveLength(3); // 10 + 10 + 5
    expect(chapters[0].pageStart).toBe(1);
    expect(chapters[0].pageEnd).toBe(10);
    expect(chapters[1].pageStart).toBe(11);
    expect(chapters[2].pageEnd).toBe(25);
  });

  it("gives each section a numbered title", () => {
    const pages = Array.from({ length: 5 }, (_, i) => makePage(i + 1, `text`));
    const chapters = groupByPages(pages, 3);
    expect(chapters[0].title).toContain("Section 1");
    expect(chapters[1].title).toContain("Section 2");
  });

  it("accumulates page text into chapter content", () => {
    const pages = [makePage(1, "hello"), makePage(2, "world")];
    const chapters = groupByPages(pages, 10);
    expect(chapters[0].content).toContain("hello");
    expect(chapters[0].content).toContain("world");
  });
});

// ---------------------------------------------------------------------------
// makeChapter
// ---------------------------------------------------------------------------
describe("makeChapter", () => {
  const pages = [
    makePage(1, "page one content"),
    makePage(2, "page two content"),
    makePage(3, "page three content"),
  ];

  it("builds a chapter with correct page range", () => {
    const ch = makeChapter("Introduction", 1, 2, pages);
    expect(ch.pageStart).toBe(1);
    expect(ch.pageEnd).toBe(2);
    expect(ch.id).toBe("ch-1");
  });

  it("combines text from pages in range only", () => {
    const ch = makeChapter("Introduction", 1, 2, pages);
    expect(ch.content).toContain("page one content");
    expect(ch.content).toContain("page two content");
    expect(ch.content).not.toContain("page three content");
  });

  it("truncates titles longer than 60 characters", () => {
    const longTitle = "A".repeat(65);
    const ch = makeChapter(longTitle, 1, 1, pages);
    expect(ch.title.length).toBeLessThanOrEqual(60);
    expect(ch.title.endsWith("…")).toBe(true);
  });

  it("preserves titles at or under 60 characters", () => {
    const title = "Short Title";
    const ch = makeChapter(title, 1, 1, pages);
    expect(ch.title).toBe(title);
  });

  it("sets status to idle", () => {
    const ch = makeChapter("Test", 1, 1, pages);
    expect(ch.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// detectChapters
// ---------------------------------------------------------------------------
describe("detectChapters", () => {
  it("returns empty array for empty page list", () => {
    expect(detectChapters([])).toEqual([]);
  });

  it("falls back to page groups when no headings are found", () => {
    const pages = Array.from({ length: 15 }, (_, i) =>
      makePage(i + 1, "This is body text without any headings.")
    );
    const chapters = detectChapters(pages);
    // Should have 2 groups: 10 + 5
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toContain("Section 1");
  });

  it("detects chapter headings and splits accordingly", () => {
    const pages = [
      makePage(1, "Introduction Some intro text follows."),
      makePage(2, "More intro text here."),
      makePage(3, "Chapter 1 The first chapter begins here."),
      makePage(4, "Body of chapter one."),
      makePage(5, "Chapter 2 The second chapter starts."),
      makePage(6, "Body of chapter two."),
    ];
    const chapters = detectChapters(pages);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    const titles = chapters.map((c) => c.title);
    expect(titles.some((t) => t.startsWith("Chapter 1"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Chapter 2"))).toBe(true);
  });

  it("falls back to page groups when only one chapter is detected", () => {
    // A single heading at page 1 means only one chapter → triggers fallback
    const pages = [
      makePage(1, "Chapter 1 The only chapter."),
      ...Array.from({ length: 9 }, (_, i) => makePage(i + 2, "body text")),
    ];
    const chapters = detectChapters(pages);
    // Fallback produces sections of 10 pages, so 1 section for 10 pages
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toContain("Section");
  });
});
