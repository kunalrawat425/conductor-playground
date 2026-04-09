/**
 * English <-> Marathi species map for Mumbai fish market.
 * Default pricing unit per species (how it's typically sold).
 */

export type PriceUnit = "piece" | "dozen" | "kg" | "gram";

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
  oyster: { english: "Oyster", marathi: "कालव", defaultUnit: "dozen" },
  clam: { english: "Clam", marathi: "शिंपल्या", defaultUnit: "dozen" },
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

export const PRICE_UNITS: { value: PriceUnit; label: string }[] = [
  { value: "piece", label: "per piece" },
  { value: "dozen", label: "per dozen" },
  { value: "kg", label: "per kg" },
  { value: "gram", label: "per gram" },
];
