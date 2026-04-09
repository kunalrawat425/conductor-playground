/**
 * English <-> Marathi species map for Mumbai fish market.
 * Default pricing unit per species (how it's typically sold).
 */

/** Count = piece; weight = kg only (use decimals e.g. 0.5 kg for half kg). */
export type PriceUnit = "piece" | "kg";

export interface Species {
  english: string;
  marathi: string;
  defaultUnit: PriceUnit;
}

export const SPECIES: Record<string, Species> = {
  pomfret: { english: "Pomfret", marathi: "पापलेट", defaultUnit: "piece" },
  surmai: { english: "Surmai (Kingfish)", marathi: "सुरमई", defaultUnit: "piece" },
  rawas: { english: "Rawas (Indian Salmon)", marathi: "रावस", defaultUnit: "piece" },
  bangda: { english: "Bangda (Mackerel)", marathi: "बांगडा", defaultUnit: "piece" },
  bombil: { english: "Bombil (Bombay Duck)", marathi: "बोंबील", defaultUnit: "piece" },
  prawns: { english: "Prawns", marathi: "कोळंबी", defaultUnit: "piece" },
  crab: { english: "Crab", marathi: "खेकडा", defaultUnit: "piece" },
  squid: { english: "Squid", marathi: "मांदेली", defaultUnit: "piece" },
  lobster: { english: "Lobster", marathi: "शेवंड", defaultUnit: "piece" },
  oyster: { english: "Oyster", marathi: "कालव", defaultUnit: "piece" },
  clam: { english: "Clam", marathi: "शिंपल्या", defaultUnit: "piece" },
  sardine: { english: "Sardine", marathi: "तारली", defaultUnit: "piece" },
  sole: { english: "Sole Fish", marathi: "लेप", defaultUnit: "piece" },
  hilsa: { english: "Hilsa", marathi: "पालवा", defaultUnit: "piece" },
  rohu: { english: "Rohu", marathi: "रोहू", defaultUnit: "piece" },
};

export const SPECIES_LIST = Object.entries(SPECIES).map(([id, s]) => ({
  id,
  ...s,
}));

export function getSpeciesById(id: string): Species | undefined {
  return SPECIES[id];
}

export function getSpeciesDisplay(id: string): string {
  const s = SPECIES[id];
  if (!s) return id;
  return `${s.english} (${s.marathi})`;
}

/** Count-based selling (one inventory pool in pieces). */
export const PRICE_UNITS_COUNT: { value: "piece"; label: string }[] = [{ value: "piece", label: "per piece" }];

/** Weight-based selling (kg only; sub-kg amounts use decimals on the same field). */
export const PRICE_UNITS_WEIGHT: { value: "kg"; label: string }[] = [{ value: "kg", label: "per kg" }];

/** All allowed units (for validation / dropdowns). */
export const PRICE_UNITS: { value: PriceUnit; label: string }[] = [
  ...PRICE_UNITS_COUNT,
  ...PRICE_UNITS_WEIGHT,
];
