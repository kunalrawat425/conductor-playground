import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env.local");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function generateImage(prompt, filename, aspectRatio) {
  console.log(`🎨 Generating: ${filename} (Ratio: ${aspectRatio})...`);
  try {
    const response = await ai.models.generateImages({
      model: "imagen-4.0-ultra-generate-001",
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
    console.error(`❌ Failed to generate ${filename}: ${err.message}`);
  }
}

const queue = [
  {
    filename: "blog-why-fish-curry-doesnt-taste-same-anymore-mumbai-hero.png",
    aspectRatio: "16:9",
    prompt: "A professional, photorealistic 16:9 landscape photo of a simmering rich pomfret curry in a premium stainless steel handi. It is cooking on a black stove in a high-end, clean modular kitchen inside a luxury Thane apartment. Soft, natural afternoon sunlight streams through a large window, lighting up the warm marble countertops. Extremely realistic textures, shallow depth of field, f/2.8, 50mm lens, no text.",
  },
  {
    filename: "ig-why-fish-curry-doesnt-taste-same-anymore-mumbai-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of a portion of rich surmai curry and white rice, beautifully plated on a premium ceramic dish. Resting on a clean marble table, shot under warm natural light in a bright Thane dining room. Realistic textures, shallow depth of field, f/2.8, 50mm lens, no text.",
  },
  {
    filename: "ig-why-fish-prices-change-daily-thane-mumbai-get-fair-rate-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of three fresh mackerels (bangda) arranged on a bed of glistening crushed ice with yellow lemon slices. Shot on a 50mm lens, f/2.8, natural light, displaying detailed silver-blue scale textures and water droplets, no text.",
  },
  {
    filename: "ig-real-cost-fish-mumbai-families-paying-more-than-should-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph comparing a premium, vacuum-sealed Relifish portion of fresh fish on ice next to a typical plastic-wrapped supermarket tray. Illustrates direct value and cleanliness, shot on 50mm, f/2.8, natural daylight, high-fidelity textures, no text.",
  },
  {
    filename: "ig-fresh-fish-thane-pre-order-revolution-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of a clean white ceramic plate with cross-cut fresh surmai steaks showing firm grey-silver flesh. Glistening wet cut surface, natural kitchen daylight, f/2.8, 50mm lens, no text.",
  },
  {
    filename: "ig-first-relifish-order-guide-thane-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of a whole fresh pomfret, glistening and fresh, resting on a clean wooden cutting board in a bright Thane apartment kitchen. Natural daylight, high-detail scales and wet skin, f/2.8, shot on 50mm lens, no text.",
  },
  {
    filename: "ig-meet-the-hyperlocal-families-behind-your-thane-fish-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of fresh, translucent raw tiger prawns with grey-green shells, arranged neatly on a bed of ice in a shiny stainless steel tray. Glistening water droplets, detailed shell textures, shot on 50mm, f/2.8, no text.",
  },
  {
    filename: "ig-neighbourhood-group-fish-preorder-thane-square.png",
    aspectRatio: "1:1",
    prompt: "A close-up, photorealistic 1:1 square photograph of a premium brown cardboard box with the black Relifish logo, resting on a clean welcome mat in front of a blue apartment door. Inside the box, fresh pomfrets and raw tiger prawns are neatly arranged on glistening crushed ice. Clean peach-colored corridor background, potted plant on the side, soft natural daylight, shot on 50mm, f/2.8, realistic texture, no text.",
  }
];

(async () => {
  console.log("🚀 Starting generation of missing creatives via Imagen 4 Ultra...");
  for (const item of queue) {
    await generateImage(item.prompt, item.filename, item.aspectRatio);
  }
  console.log("🎉 All missing assets generated successfully!");
})();
