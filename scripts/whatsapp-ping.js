/**
 * Sends a review notification to the founder via WhatsApp / SMS (Simulated).
 * @param {object} campaign - The campaign object with topic details.
 * @param {string} slug - The generated blog post slug.
 */
export async function pingFounderForReview(campaign, slug) {
  const message = `🐟 *Relifish Content Alert* 🐟\n\nNew campaign ready for review:\n*Topic:* ${campaign.topic}\n*Slug:* ${slug}\n\n🔗 *Preview Draft:* src/pages/blog/${slug}.md\n\nApprove in Supabase to auto-publish to Instagram & Facebook!`;

  console.log("\n-----------------------------------------");
  console.log("🔔 [WhatsApp Simulation] Sending to Founder...");
  console.log(message);
  console.log("-----------------------------------------\n");

  console.log("ℹ️  Messaging transmission is in Simulation Mode only.");
  return { ok: true, simulated: true };
}

// Allow direct CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Testing WhatsApp ping...");
  pingFounderForReview({ topic: "Monsoon Safety Guidelines for Thane Fish Buyers" }, "monsoon-fish-guide-thane-fresh-fish-june-july");
}
