import { describe, expect, it } from "vitest";
import { geolocateErrorMessage } from "../../src/lib/geolocate-error";

describe("geolocateErrorMessage", () => {
  it("explains a blocked permission with how to allow it", () => {
    expect(geolocateErrorMessage(1).title).toBe("Location is blocked for Relifish");
    expect(geolocateErrorMessage(1).body).toContain("Allow");
  });
  it("asks to turn on GPS when the position is unavailable", () => {
    expect(geolocateErrorMessage(2).body).toContain("GPS");
  });
  it("treats a timeout or unknown code as try again", () => {
    expect(geolocateErrorMessage(3).title).toBe("Location took too long");
    expect(geolocateErrorMessage(undefined).title).toBe("Location took too long");
  });
  it("points in-app browsers to Chrome whatever the code", () => {
    const ig = "Mozilla/5.0 (Linux; Android 14) Instagram 300.0";
    expect(geolocateErrorMessage(1, ig).body).toContain("Chrome");
  });
});
