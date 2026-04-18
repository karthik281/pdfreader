import "@testing-library/jest-dom";

// Mock browser APIs that are unavailable in jsdom
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: jest.fn(() => "blob:mock-url"),
});
Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: jest.fn(),
});
