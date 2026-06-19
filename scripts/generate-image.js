import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateImage(prompt, filename, aspectRatio = "1:1") {
  console.log(`\nGenerating: ${filename}...`);
  try {
    const response = await ai.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: "image/png",
        aspectRatio,
      },
    });

    const imageData = response.generatedImages[0].image.imageBytes;
    const buffer = Buffer.from(imageData, "base64");
    const outPath = path.join("public", filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`✅ Saved: ${outPath}`);
    return outPath;
  } catch (err) {
    console.error(`❌ Failed: ${filename} — ${err.message}`);
  }
}

// ─── PROMPT QUEUE ─────────────────────────────────────────────
// Edit this list to add new images. Run: node scripts/generate-image.js

const queue = [
  {
    filename: "relifish-slide3-moat.png",
    aspectRatio: "1:1",
    prompt: `Instagram carousel slide 1080x1080px. Relifish brand electric blue background #2563EB.
Top left: "Relifish" white bold wordmark logo.
Bold white uppercase headline: "WHY RELIFISH IS DIFFERENT."
Below: 4 white pill-shaped badges stacked vertically with blue text:
"🐟  Know your seller by NAME — not just a brand"
"⏰  PRE-ORDER tomorrow's catch before it sells out"
"✅  NEVER FROZEN. Never preserved. Same-day only."
"📍  DIRECT SELLER RATES — what the mandi charges, what you pay"
Smaller white text below: "This is the Freshness Trust Layer Mumbai never had."
Bottom center amber #F59E0B bold: "relifish.store"
Clean, bold, modern graphic. No photos. White on blue.`,
  },
  {
    filename: "relifish-slide5-cta.png",
    aspectRatio: "1:1",
    prompt: `Instagram carousel slide 1080x1080px.
Right side: photorealistic fresh fish on crushed ice (pomfret, tiger prawns, surmai steak, bangda).
Left side and bottom: Relifish electric blue #2563EB solid.
Top left: "Relifish" white bold wordmark logo.
Large bold white uppercase: "LAUNCHING IN THANE SOON."
Smaller white: "Hiranandani Estate · Majiwada · Ghodbunder Road · Kasarvadavali"
Amber #F59E0B bold: "Join the waitlist → relifish.store"
Bottom small white: "Hyperlocal. Fresh. Affordable."
Commercial, clean, confident closing slide.`,
  },
  {
    filename: "relifish-article1-hero.png",
    aspectRatio: "16:9",
    prompt: `Photorealistic blog hero 16:9 landscape. Mumbai home kitchen, warm afternoon light through window.
Close-up of a steel handi with fish curry being stirred by a woman's hand with bangles.
Steam rising. Rice in steel bowl beside it.
Fish pieces in curry look slightly pale and uniform — subtly disappointing beneath warm surface.
Documentary photography style. Film grain. No text. No plastic.`,
  },
];

(async () => {
  console.log(`\n🐟 Relifish Image Generator — Imagen 3`);
  console.log(`Running ${queue.length} image(s)...\n`);
  for (const item of queue) {
    await generateImage(item.prompt, item.filename, item.aspectRatio);
  }
  console.log(`\n✅ All done. Check the /public folder.`);
})();
