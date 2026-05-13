import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  keyToDisplayName,
} from "./format";

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500.0 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });

  it("respects decimals parameter", () => {
    expect(formatBytes(1536, 2)).toBe("1.50 KB");
  });
});

describe("formatSpeed", () => {
  it("formats bytes per second", () => {
    expect(formatSpeed(1048576)).toBe("1.0 MB/s");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(150)).toBe("2m 30s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3661)).toBe("1h 1m");
  });

  it("handles negative values", () => {
    expect(formatDuration(-1)).toBe("--");
  });
});

describe("keyToDisplayName", () => {
  it("extracts filename from key", () => {
    expect(keyToDisplayName("path/to/file.txt")).toBe("file.txt");
  });

  it("extracts folder name from prefix", () => {
    expect(keyToDisplayName("path/to/folder/")).toBe("folder");
  });

  it("handles root-level keys", () => {
    expect(keyToDisplayName("file.txt")).toBe("file.txt");
  });
});
