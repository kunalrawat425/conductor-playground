/**
 * Buyer guide per fish, shown on /fish/<species> under the live seller table.
 * Facts only (common names, how it eats, cuts, dishes, availability). No health claims, no prices
 * (live prices come from listings), no promises. Keep each guide specific to the fish.
 */
export interface SpeciesGuide {
  /** Other names buyers search for. */
  alsoCalled: string[];
  /** One-line answer-first summary. */
  summary: string;
  taste: string;
  bones: string;
  cuts: string[];
  dishes: string[];
  /** When it is easiest to find in Mumbai markets. */
  availability: string;
  /** Anything a buyer should know before ordering. */
  buyingTip: string;
}

const BAN = "Like other sea fish, it is scarce during Maharashtra's monsoon fishing ban (from June 1; to August 15 in 2026).";

export const SPECIES_GUIDES: Record<string, SpeciesGuide> = {
  surmai: {
    alsoCalled: ["Kingfish", "Seer fish", "King mackerel", "Vanjaram"],
    summary: "Surmai is a firm, meaty sea fish, one of Mumbai's favourite fish for fry and curry.",
    taste: "Rich, meaty and mildly flavoured; holds its shape when fried or cooked in gravy.",
    bones: "One central bone in steaks; very few small bones.",
    cuts: ["Steaks (slices)", "Curry cut", "Whole (cleaned)"],
    dishes: ["Surmai rava fry", "Malvani surmai curry", "Tawa fry", "Grilled steaks"],
    availability: `Sold through the year when boats go out. ${BAN}`,
    buyingTip: "Steaks should be firm, moist and pinkish-white, not dull or dry at the edges.",
  },
  pomfret: {
    alsoCalled: ["Paplet", "Silver pomfret", "White pomfret", "Saranga"],
    summary: "Pomfret (paplet) is a flat, delicate sea fish, usually fried whole or cooked in a light curry.",
    taste: "Soft, sweet and mild; one of the gentlest-tasting sea fish.",
    bones: "Few bones and one central spine; easy to eat off the bone.",
    cuts: ["Whole (cleaned, with or without head)", "Slit for stuffing", "Curry pieces"],
    dishes: ["Pomfret fry", "Stuffed pomfret (bharleli)", "Patra ni machhi", "Pomfret curry"],
    availability: `Sold by size (small, medium, large). Larger pomfret costs more per kg. ${BAN}`,
    buyingTip: "Look for bright, silvery skin and clear eyes; the body should feel firm, not soft.",
  },
  prawns: {
    alsoCalled: ["Kolambi", "Jhinga", "Shrimp"],
    summary: "Prawns (kolambi) are sold by size, whole or cleaned, from small to tiger/jumbo.",
    taste: "Sweet and firm when fresh; cooks in a few minutes.",
    bones: "No bones; shell, head and the dark vein are removed when cleaned.",
    cuts: ["Whole", "Headless", "Peeled and deveined", "Tail-on"],
    dishes: ["Prawns koliwada-style fry", "Prawn curry", "Prawn biryani", "Butter garlic prawns"],
    availability: "Farmed prawns are available through the year, including the monsoon; sea prawns follow the fishing season.",
    buyingTip: "Shells should be firm and shiny with heads attached and no black patches; avoid a sour or ammonia smell.",
  },
  rawas: {
    alsoCalled: ["Indian salmon", "Fourfinger threadfin"],
    summary: "Rawas, also called Indian salmon, is a mild, firm white-fleshed sea fish popular for steaks and curry.",
    taste: "Mild and slightly sweet with firm, flaky flesh.",
    bones: "A central bone in steaks; few small bones.",
    cuts: ["Steaks (slices)", "Curry cut", "Fillets"],
    dishes: ["Rawas fry", "Rawas curry", "Fish tikka", "Grilled steaks"],
    availability: `A sea fish sold through the fishing season. ${BAN}`,
    buyingTip: "Rawas is not the same as imported salmon; ask the seller if you are unsure which one is listed.",
  },
  bangda: {
    alsoCalled: ["Indian mackerel", "Bangude", "Ayala"],
    summary: "Bangda (Indian mackerel) is a small, oily sea fish with a strong flavour, usually fried or made into tikhla or curry.",
    taste: "Rich and full-flavoured because it is an oily fish.",
    bones: "Fine bones along the body; easier to eat when fried crisp.",
    cuts: ["Whole (cleaned)", "Slit for masala", "Curry pieces"],
    dishes: ["Bangda fry", "Bangda tikhla", "Bangda curry", "Stuffed bangda"],
    availability: `Usually one of the more affordable sea fish when in season. ${BAN}`,
    buyingTip: "Fresh bangda has bright, tight skin and red gills; it spoils faster than lean fish, so cook it the same day.",
  },
  bombil: {
    alsoCalled: ["Bombay duck", "Bombili"],
    summary: "Bombil (Bombay duck) is a very soft, delicate fish, famous in Mumbai as rava-fried bombil.",
    taste: "Very soft, almost melt-in-the-mouth; mild flavour.",
    bones: "A soft central bone; very few small bones.",
    cuts: ["Whole (cleaned)", "Butterflied (flattened for fry)"],
    dishes: ["Bombil rava fry", "Bombil curry", "Bombil koliwada-style fry"],
    availability: `Sold fresh in season and also as dried bombil. ${BAN}`,
    buyingTip: "It is naturally soft; press-drying it before frying gives a crisp fry.",
  },
  halwa: {
    alsoCalled: ["Black pomfret", "Halva"],
    summary: "Halwa (black pomfret) is a firmer, darker cousin of white pomfret, good for fry and curry.",
    taste: "Firmer and slightly stronger than white pomfret.",
    bones: "One central spine; few small bones.",
    cuts: ["Whole (cleaned)", "Steaks", "Curry pieces"],
    dishes: ["Halwa fry", "Halwa curry", "Tawa fry"],
    availability: `Usually costs less than white pomfret. ${BAN}`,
    buyingTip: "Skin should be shiny and dark grey with clear eyes.",
  },
  ghol: {
    alsoCalled: ["Croaker", "Blackspotted croaker"],
    summary: "Ghol is a large croaker with firm white flesh, sold in steaks and pieces.",
    taste: "Mild with firm, meaty white flesh.",
    bones: "Few bones in steaks.",
    cuts: ["Steaks", "Curry pieces", "Fillets"],
    dishes: ["Ghol fry", "Ghol curry", "Grilled steaks"],
    availability: `A large sea fish, usually sold cut. ${BAN}`,
    buyingTip: "Ask for the cut size you need; large fish are sold in pieces by weight.",
  },
  bhetki: {
    alsoCalled: ["Barramundi", "Asian sea bass", "Bhekti"],
    summary: "Bhetki (barramundi) is a firm, mild white fish, popular for fillets and fish fry.",
    taste: "Mild and buttery with firm white flesh.",
    bones: "Fillets are boneless; steaks have a central bone.",
    cuts: ["Fillets", "Steaks", "Fry cut"],
    dishes: ["Fish fry (Bengali/Parsi style)", "Pan-fried fillets", "Bhetki curry"],
    availability: "Available through much of the year.",
    buyingTip: "Fillets should look moist and translucent, not dry or grey.",
  },
  boi: {
    alsoCalled: ["Mullet", "Grey mullet"],
    summary: "Boi (mullet) is an everyday fish with soft, flavourful flesh, cooked whole or in curry.",
    taste: "Soft with a distinct, slightly rich flavour.",
    bones: "Several fine bones.",
    cuts: ["Whole (cleaned)", "Curry pieces"],
    dishes: ["Boi fry", "Boi curry"],
    availability: "Often available when other sea fish are scarce, depending on the seller's supply.",
    buyingTip: "Buy small to medium fish for frying; larger fish suit curry.",
  },
  katla: {
    alsoCalled: ["Catla", "Bengal carp"],
    summary: "Katla is a large freshwater carp, a staple for Bengali-style fish curry.",
    taste: "Mild, slightly sweet freshwater flavour.",
    bones: "Has many fine bones, as freshwater carp do.",
    cuts: ["Steaks", "Curry pieces", "Head (for curry)"],
    dishes: ["Bengali fish curry (kalia, jhol)", "Fried katla"],
    availability: "Freshwater, so it is not affected by the sea fishing ban and is available in the monsoon.",
    buyingTip: "Ask for curry pieces of even size so they cook evenly.",
  },
  rohu: {
    alsoCalled: ["Rui", "Rohu carp"],
    summary: "Rohu is a freshwater carp, widely used for curry and fry across India.",
    taste: "Mild freshwater flavour; takes spices well.",
    bones: "Has many fine bones, as freshwater carp do.",
    cuts: ["Curry pieces", "Steaks", "Whole (cleaned)"],
    dishes: ["Rohu curry", "Rohu fry", "Macher jhol"],
    availability: "Freshwater, so it is not affected by the sea fishing ban and is available in the monsoon.",
    buyingTip: "Firm pieces with bright red gills on the head piece are a good sign.",
  },
  basa: {
    alsoCalled: ["Pangasius", "Basa fillet"],
    summary: "Basa is a farmed freshwater fish usually sold as boneless fillets, good for children and quick meals.",
    taste: "Very mild and soft.",
    bones: "Sold as boneless fillets.",
    cuts: ["Boneless fillets", "Fingers / cubes"],
    dishes: ["Fish fingers", "Pan-fried fillets", "Fish curry", "Fish tikka"],
    availability: "Farmed, so it is available through the year, including the monsoon.",
    buyingTip: "Ask the seller whether the fillets are fresh or frozen; both are common.",
  },
  salmon: {
    alsoCalled: ["Atlantic salmon"],
    summary: "Salmon sold in Mumbai is usually imported; it is different from rawas, which is sometimes called Indian salmon.",
    taste: "Rich, oily and buttery; pink-orange flesh.",
    bones: "Fillets have few pin bones; steaks have a central bone.",
    cuts: ["Fillets", "Steaks"],
    dishes: ["Pan-seared salmon", "Grilled salmon", "Salmon curry"],
    availability: "Imported, so availability depends on the seller's supply rather than the local season.",
    buyingTip: "Ask the seller where it is from and whether it is fresh or frozen.",
  },
  shark: {
    alsoCalled: ["Mushi", "Baby shark"],
    summary: "Mushi (small shark) is a firm, boneless-feeling fish, traditionally cooked in a spicy Konkani curry.",
    taste: "Firm and meaty with a distinct flavour.",
    bones: "Cartilage instead of bones; easy to eat.",
    cuts: ["Curry pieces", "Steaks"],
    dishes: ["Mushi curry", "Mushi masala"],
    availability: `Depends on the catch and the seller. ${BAN}`,
    buyingTip: "Cook it soon after buying; firm, odour-free pieces are fresh.",
  },
  crab: {
    alsoCalled: ["Khekda", "Mud crab"],
    summary: "Crabs (khekda) are sold whole, usually by weight; heavier crabs for their size have more meat.",
    taste: "Sweet, rich meat in the body and claws.",
    bones: "Shell only; cracked for eating.",
    cuts: ["Whole (cleaned)", "Halved", "Curry pieces"],
    dishes: ["Crab masala", "Crab curry", "Crab sukka"],
    availability: "Depends on the seller's supply; many sellers take crabs on pre-order.",
    buyingTip: "Choose crabs that feel heavy for their size; ask the seller to clean and cut them for curry.",
  },
};

/** A /fish/<species> page is indexable when a live seller lists it AND it has a guide (no thin pages). */
export function hasGuide(species: string): boolean {
  return Object.hasOwn(SPECIES_GUIDES, species);
}
