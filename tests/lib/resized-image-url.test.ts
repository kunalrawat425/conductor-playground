import { describe, it, expect } from "vitest";
import { resizedImageUrl } from "../../src/lib/seller-display";

const prod = "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/object/public/fish-photos/a.jpg";
const stage = "https://nyavzumoljcrmmwcdcuj.supabase.co/storage/v1/object/public/fish-photos/a.jpg";

describe("resizedImageUrl", () => {
  it("resizes prod Supabase photos", () => {
    expect(resizedImageUrl(prod, 300)).toBe(
      "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/render/image/public/fish-photos/a.jpg?width=300&quality=70&resize=contain",
    );
  });
  it("serves staging photos unresized (no image transforms there)", () => {
    expect(resizedImageUrl(stage, 300)).toBe(stage);
    expect(resizedImageUrl(stage.replace("/object/", "/render/image/") + "?width=700", 300)).toBe(stage);
  });
  it("leaves other URLs and empty values alone", () => {
    expect(resizedImageUrl("/fish/pomfret.jpg", 300)).toBe("/fish/pomfret.jpg");
    expect(resizedImageUrl(null, 300)).toBeNull();
  });
});
