import { describe, it, expect } from "vitest";
import {
  SPECIES,
  SPECIES_LIST,
  getSpeciesById,
  getSpeciesDisplay,
  PRICE_UNITS,
} from "../../src/lib/species";

describe("species", () => {
  it("has at least 10 species", () => {
    expect(Object.keys(SPECIES).length).toBeGreaterThanOrEqual(10);
  });

  it("every species has english, marathi, and defaultUnit", () => {
    for (const [id, s] of Object.entries(SPECIES)) {
      expect(s.english).toBeTruthy();
      expect(s.marathi).toBeTruthy();
      expect(["kg", "piece", "dozen"]).toContain(s.defaultUnit);
    }
  });

  it("SPECIES_LIST includes id field", () => {
    expect(SPECIES_LIST.length).toBeGreaterThan(0);
    expect(SPECIES_LIST[0]).toHaveProperty("id");
    expect(SPECIES_LIST[0]).toHaveProperty("english");
  });

  it("getSpeciesById returns correct species", () => {
    const pomfret = getSpeciesById("pomfret");
    expect(pomfret?.english).toBe("Pomfret");
    expect(pomfret?.marathi).toBe("पापलेट");
    expect(pomfret?.defaultUnit).toBe("piece");
  });

  it("getSpeciesById returns undefined for unknown", () => {
    expect(getSpeciesById("nonexistent")).toBeUndefined();
  });

  it("getSpeciesDisplay formats correctly", () => {
    expect(getSpeciesDisplay("pomfret")).toBe("Pomfret (पापलेट)");
    expect(getSpeciesDisplay("prawns")).toBe("Prawns (कोळंबी)");
  });

  it("getSpeciesDisplay returns id for unknown species", () => {
    expect(getSpeciesDisplay("unknown_fish")).toBe("unknown_fish");
  });

  it("PRICE_UNITS has piece and dozen", () => {
    const values = PRICE_UNITS.map((u) => u.value);
    expect(values).toContain("piece");
    expect(values).toContain("dozen");
  });

  it("pomfret defaults to piece, prawns to piece, oyster to dozen", () => {
    expect(SPECIES.pomfret?.defaultUnit).toBe("piece");
    expect(SPECIES.prawns?.defaultUnit).toBe("piece");
    expect(SPECIES.oyster?.defaultUnit).toBe("dozen");
  });
});
