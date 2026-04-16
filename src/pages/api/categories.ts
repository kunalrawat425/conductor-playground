import type { APIRoute } from "astro";

// Categories for V2 home category strip.
// Hardcoded for MVP. Move to DB table when curation is needed.
const CATEGORIES = [
  { id: "all", name: "All Fish", emoji: "🐟", species: [] },
  { id: "prawns", name: "Prawns", emoji: "🦐", species: ["prawn", "tiger_prawn", "white_prawn"] },
  { id: "crab", name: "Crab", emoji: "🦀", species: ["crab", "mud_crab"] },
  { id: "squid", name: "Squid", emoji: "🦑", species: ["squid", "octopus", "cuttlefish"] },
  { id: "shellfish", name: "Shellfish", emoji: "🐚", species: ["clam", "mussel", "oyster"] },
  { id: "seafood", name: "Seafood", emoji: "🍤", species: ["lobster"] },
  { id: "sea_fish", name: "Sea Fish", emoji: "🌊", species: ["surmai", "rawas", "pomfret", "bangda", "ghol", "hilsa"] },
];

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ success: true, categories: CATEGORIES }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    }
  );
};

export const prerender = false;
