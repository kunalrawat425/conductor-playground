import { describe, it, expect } from "vitest";
import { cropRect, CROP, imageFileError, imageDimensionsError } from "../../src/lib/image-crop";

describe("cropRect", () => {
  it("takes the largest centred square from a landscape photo at zoom 1", () => {
    expect(cropRect(4000, 3000, CROP.logo.aspect, 1, 2000, 1500)).toEqual({ x: 500, y: 0, w: 3000, h: 3000 });
  });

  it("takes a full-width 3:2 band from a portrait photo for the banner", () => {
    expect(cropRect(1200, 2000, CROP.banner.aspect, 1, 600, 1000)).toEqual({ x: 0, y: 600, w: 1200, h: 800 });
  });

  it("shrinks with zoom and keeps the rect inside the image when dragged past an edge", () => {
    expect(cropRect(1000, 1000, 1, 2, -500, 5000)).toEqual({ x: 0, y: 500, w: 500, h: 500 });
  });

  it("treats zoom below 1 as 1", () => {
    expect(cropRect(1000, 500, 2, 0.5, 500, 250)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });
});

describe("imageFileError", () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });
  it("accepts JPEG, PNG and WebP under 5 MB", () => {
    expect(imageFileError(f("a.jpg", "image/jpeg"))).toBeNull();
    expect(imageFileError(f("a.JPEG", "image/jpeg"))).toBeNull();
    expect(imageFileError(f("a.png", "image/png"))).toBeNull();
    expect(imageFileError(f("a.webp", "image/webp"))).toBeNull();
  });
  it("rejects HEIC, GIF, SVG and a mismatched extension", () => {
    for (const [n, t] of [["a.heic", "image/heic"], ["a.gif", "image/gif"], ["a.svg", "image/svg+xml"], ["a.svg", "image/png"], ["a.jpg", ""]]) {
      expect(imageFileError(f(n, t))).toMatch(/JPEG, PNG or WebP/);
    }
  });
  it("rejects files over 5 MB with the size in the message", () => {
    expect(imageFileError(f("a.jpg", "image/jpeg", 7.2 * 1024 * 1024))).toBe("This image is 7.2 MB. Please choose one under 5 MB.");
    expect(imageFileError(f("a.jpg", "image/jpeg", 5 * 1024 * 1024))).toBeNull();
  });
});

describe("imageDimensionsError", () => {
  it("needs a logo of at least 200x200", () => {
    expect(imageDimensionsError("logo", 200, 200)).toBeNull();
    expect(imageDimensionsError("logo", 400, 150)).toMatch(/^Image too small: use at least 200×200 px/);
  });
  it("needs a listing photo of at least 400x400, cropped square", () => {
    expect(CROP.listing).toMatchObject({ aspect: 1, outW: 800 }); // 800x800 export
    expect(CROP.logo).toMatchObject({ aspect: 1, outW: 512 });
    expect(CROP.banner).toMatchObject({ aspect: 1.5, outW: 1500 }); // 3:2, matches the 260 px hero on a 390 px phone
    expect(imageDimensionsError("listing", 400, 400)).toBeNull();
    expect(imageDimensionsError("listing", 1200, 399)).toBe("Image too small: use at least 400×400 px (this one is 1200×399).");
  });
  it("needs a banner at least 800 px wide", () => {
    expect(imageDimensionsError("banner", 800, 300)).toBeNull();
    expect(imageDimensionsError("banner", 640, 1200)).toMatch(/^Image too small: use at least 800 px wide/);
  });
});
