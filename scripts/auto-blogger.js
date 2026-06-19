import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { pingFounderForReview } from './whatsapp-ping.js';
import { publishToMeta } from './meta-api.js';

// Load env vars
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY. Please set it in .env.local");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  console.log("ℹ️  Supabase URL/Key missing. Auto-blogger will operate exclusively in local queue mode.");
}

const MASTER_PROMPT_TEMPLATE = `
You are the Chief Brand Officer, Consumer Psychologist, Hyperlocal Growth Lead, and Master Copywriter for Relifish.

Your objective is to compile a complete, high-converting content marketing bundle (Blog post + Instagram Carousel Caption + Facebook post + WhatsApp broadcast) for a target Topic and Key Phrase.

Context:
Relifish is a hyperlocal seafood marketplace in Thane (serving Hiranandani Estate, Ghodbunder Road, Majiwada, Kasarvadavali). We connect buyers directly to local Koli sellers. We operate as the "Freshness Trust Layer," solving the bad trade-off between convenience (which usually means stale, warehouse-stored fish with a 30% delivery app markup) and freshness (which usually means waking up at 6 AM to visit a smelly local mandi).

STRICT BRAND RULES & MENTAL MODELS (DO NOT DEVIATE):
1. MARKETPLACE OVER COUPONS:
   - Relifish is a DIRECT MARKETPLACE, not a coupon/discount brand.
   - NEVER mention discount coupons, coupon codes, flat-rate discounts, or percentage-off gimmicks.
   - Position value around "direct seller rates" / "what the mandi charges" — fair, transparent pricing directly from the dock.

2. FRESHNESS OVER COLD CHAIN:
   - Emphasize morning-fresh dock-direct catch delivered in ice under 4 hours (caught at 4:15 AM, on your plate for lunch).
   - Frame the competition's "cold chain," "refrigerated warehouses," and "dark stores" as a compromise. Cold chain keeps fish from rotting, but it ruins the texture, natural juices, and authentic sea flavor, delivering 3-day-old stale fish.

3. CONNECTION BUILDING:
   - Frame purchases as building a direct relationship between Koli fishing families and Thane households.
   - Mention local Koli sellers, their names, and their heritage. Show that buying here directly supports local livelihoods instead of corporate dark store warehouses.

4. COMPETITOR CONTRAST (What they do vs what we do):
   - Contrast Relifish with delivery apps/supermarkets which charge 30% markups, use chemical treatments (like formalin/ammonia), and deliver warehouse-stored fish.
   - Highlight the 100% Odour-Free refund guarantee to eliminate the buyer's risk.

Visuals & Style Guidance for Image Prompts:
- Every prompt generated for Imagen 4 MUST describe a highly realistic, premium, and authentic photograph.
- Visual style: Genuinely realistic, documentary-style, shot on 50mm or 85mm lens, f/2.8 aperture, background blur, shallow depth of field, natural warm afternoon sunlight, clean surroundings, and realistic textures.
- Environments: Upscale Thane high-rise residential corridors/doorways (peach/terracotta walls, blue door frames, clean tile floors, potted green plants, welcome mats) or high-end clean modular kitchens.
- Characters: If delivery is shown, the delivery partner must be a woman wearing a dark teal polo shirt with a small white 'relifish.store' sleeve wordmark, dark cargo pants, a grey cap, grey face mask, and white gloves, carrying a dark blue insulated backpack with the white Relifish logo. The customer must be an Indian woman smiling warmly, wearing a bright royal blue kurta with white trousers.
- Packaging: Premium light brown cardboard boxes with black Relifish wordmark and fish logo on the side. Seafood (glistening pomfrets, surmai, prawns) should be arranged neatly on clean crushed ice inside the box.
- NO clean vectors, graphic design overlays, digital illustrations, 3D renders, cartoon characters, or artificial studio lighting.
- NO text, logos, or labels in the generated images (except the brand logos on uniforms/boxes as described above).
- Make sure all prompts are highly relevant to the specific blog topic and social media post content.

Inputs:
- [Topic]: {topic}
- [Primary Keyword]: {keywords}
- [Target Locality]: {locality}
`;

// Schema definition for Structured JSON Output
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    slug: { 
      type: "STRING", 
      description: "URL-friendly slug (e.g. why-fish-prices-change-daily-mumbai)" 
    },
    meta_title: { 
      type: "STRING", 
      description: "SEO optimized meta title under 60 characters" 
    },
    meta_description: { 
      type: "STRING", 
      description: "Compelling search description under 155 characters" 
    },
    blog_content: { 
      type: "STRING", 
      description: "Full markdown string of the blog post (800-1200 words). Start directly with a hook. Use standard markdown headers (h2, h3). Do not include frontmatter or title inside this field, only the body content." 
    },
    social_caption_ig: { 
      type: "STRING", 
      description: "Instagram caption with hooks, bullet points, calls to action, and relevant hashtags" 
    },
    social_caption_fb: { 
      type: "STRING", 
      description: "Facebook post copy with storytelling hook and direct waitlist/store link" 
    },
    blog_hero_image_prompt: { 
      type: "STRING", 
      description: "A highly detailed, photorealistic 16:9 Imagen 4 prompt to generate the blog's hero image. E.g. 'A close-up documentary photograph of raw pomfret steaks on crushed ice, shot on 35mm, f/2.8, warm window lighting, realistic texture, no text.'" 
    },
    instagram_carousel_image_prompts: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "List of 3 distinct, photorealistic 1:1 Imagen 4 prompts representing the slides (pain, solution, call to action). Describe authentic, high-fidelity scenes with natural lighting, no text overlays."
    }
  },
  required: [
    "slug",
    "meta_title",
    "meta_description",
    "blog_content",
    "social_caption_ig",
    "social_caption_fb",
    "blog_hero_image_prompt",
    "instagram_carousel_image_prompts"
  ]
};

// Local fallback queue of articles (for local runs or if Supabase calendar is empty)
const LOCAL_CONTENT_QUEUE = [
  {
    id: "local-1",
    topic: "Why Your Sunday Fish Curry Never Tastes the Same Anymore — And It's Not Your Recipe",
    keywords: ["fresh fish delivery Mumbai", "why fish tastes different"],
    target_locality: "Thane",
    slug: "why-fish-curry-doesnt-taste-same-anymore-mumbai"
  },
  {
    id: "local-2",
    topic: "Why Fish Prices Change Every Day in Mumbai — And How to Know If You're Getting a Fair Rate",
    keywords: ["pomfret price Mumbai", "surmai price today", "fish price Thane"],
    target_locality: "Thane",
    slug: "why-fish-prices-change-daily-mumbai"
  },
  {
    id: "local-3",
    topic: "The Real Cost of Your Fish: How Mumbai Families Are Paying 30–40% More Than They Should",
    keywords: ["cheap fresh fish Mumbai", "fish prices online vs market", "no markup fish delivery"],
    target_locality: "Thane",
    slug: "real-cost-of-fish-mumbai-markup"
  },
  {
    id: "local-4",
    topic: "How Thane Professionals Buy Fresh Fish Without Waking Up at 6 AM — The Pre-Order Revolution",
    keywords: ["fish home delivery Thane", "fresh fish online order", "pre-order fish Mumbai"],
    target_locality: "Thane",
    slug: "thane-professionals-preorder-fish-revolution"
  },
  {
    id: "local-5",
    topic: "Your First Order on Relifish: What to Expect, What to Order, and Why You Won't Go Back",
    keywords: ["buy fish online Mumbai first time", "Relifish how to order"],
    target_locality: "Thane",
    slug: "first-order-relifish-guide"
  },
  {
    id: "local-6",
    topic: "Meet the Koli Families Behind Your Catch: The Real People of Mumbai's Fish Trade",
    keywords: ["Koli fishermen Mumbai", "local fish sellers Thane", "sustainable seafood Mumbai"],
    target_locality: "Thane",
    slug: "meet-koli-families-behind-catch"
  },
  {
    id: "local-7",
    topic: "How Your Building Can Get Fresh Fish Together — The Relifish Neighbourhood Pre-Order Guide",
    keywords: ["group fish order Mumbai", "society fish delivery Thane", "fresh fish Hiranandani Estate"],
    target_locality: "Thane",
    slug: "neighborhood-group-preorder-fish-guide"
  },
  {
    id: "local-8",
    topic: "The Sunday Fish Problem Every Mumbai Family Knows — And Nobody Has Fixed Until Now",
    keywords: ["fresh fish home delivery Mumbai", "fish delivery Thane", "Sunday fish curry"],
    target_locality: "Thane",
    slug: "sunday-fish-ritual-mumbai-family-tradition"
  }
];

async function generateCampaign(articleIndex = null) {
  console.log("Checking for content generation task...");
  let task = null;

  // 1. Try to fetch from Supabase first if available
  if (supabase) {
    try {
      const { data: records, error } = await supabase
        .from('content_calendar')
        .select('*')
        .eq('status', 'pending')
        .order('scheduled_for', { ascending: true })
        .limit(1);

      if (!error && records && records.length > 0) {
        task = records[0];
        console.log(`Fetched task from Supabase: "${task.topic}"`);
      }
    } catch (dbErr) {
      console.log("Supabase fetch failed or table doesn't exist. Falling back to local content queue.");
    }
  }

  // 2. Local fallback if no Supabase task
  if (!task) {
    console.log("Using Local Content Queue...");
    const idx = articleIndex !== null ? articleIndex : 1; // Default to index 1 (Article 5)
    if (idx < 0 || idx >= LOCAL_CONTENT_QUEUE.length) {
      console.error(`Invalid local queue index: ${idx}. Queue length: ${LOCAL_CONTENT_QUEUE.length}`);
      return;
    }
    task = LOCAL_CONTENT_QUEUE[idx];
    console.log(`Selected Local Topic: "${task.topic}"`);
  }

  try {
    // Prepare prompt
    const prompt = MASTER_PROMPT_TEMPLATE
      .replace('{topic}', task.topic)
      .replace('{keywords}', (task.keywords || []).join(', '))
      .replace('{locality}', task.target_locality || 'Thane');

    console.log("🤖 Querying Gemini for structured content bundle...");
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
      }
    });

    const campaignData = JSON.parse(response.text.trim());
    console.log("✅ Content generated and parsed successfully.");
    console.log(`Generated Slug: ${campaignData.slug}`);

    // Generate Blog Hero Image via Imagen 4
    let heroImageFileName = `blog-${campaignData.slug}-hero.png`;
    let heroImagePath = `/${heroImageFileName}`;
    
    if (campaignData.blog_hero_image_prompt) {
      console.log(`🎨 Generating Blog Hero Image via Imagen 4: ${heroImageFileName}...`);
      console.log(`Prompt: ${campaignData.blog_hero_image_prompt}`);
      try {
        const imageResponse = await ai.models.generateImages({
          model: 'imagen-4.0-ultra-generate-001',
          prompt: campaignData.blog_hero_image_prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/png',
            aspectRatio: '16:9'
          }
        });
        
        const imageData = imageResponse.generatedImages[0].image.imageBytes;
        const buffer = Buffer.from(imageData, 'base64');
        const outPath = path.join('public', heroImageFileName);
        fs.writeFileSync(outPath, buffer);
        console.log(`✅ Saved Hero Image to: ${outPath}`);
      } catch (imgErr) {
        console.error("⚠️  Failed to generate image via Imagen:", imgErr.message);
        heroImagePath = "/blog-placeholder-hero.png"; // Fallback placeholder
      }
    }

    // Save Blog Content locally under src/pages/blog/
    const blogDir = path.join(process.cwd(), 'src/pages/blog');
    if (!fs.existsSync(blogDir)) {
      fs.mkdirSync(blogDir, { recursive: true });
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const frontmatter = `---
layout: ../../layouts/Layout.astro
title: "${campaignData.meta_title.replace(/"/g, '\\"')}"
description: "${campaignData.meta_description.replace(/"/g, '\\"')}"
pubDate: ${dateStr}
author: "Relifish Team"
tags: ["Fresh Fish", "Thane", "Koli Sellers", "Market Rates"]
image: "${heroImagePath}"
---

# ${campaignData.meta_title}

`;

    const blogPath = path.join(blogDir, `${campaignData.slug}.md`);
    fs.writeFileSync(blogPath, frontmatter + campaignData.blog_content);
    console.log(`✅ Saved Blog Post to: ${blogPath}`);

    // Save full campaign data as JSON in public/assets/campaigns/
    const campaignJsonPath = path.join(process.cwd(), 'public/assets/campaigns', `${campaignData.slug}.json`);
    const campaignJsonData = {
      topic: task.topic,
      primary_keyword: (task.keywords || []).join(', '),
      target_locality: task.target_locality || 'Thane',
      google_flow_media_url: heroImagePath,
      metadata: {
        recommended_title: campaignData.meta_title,
        meta_title: campaignData.meta_title,
        meta_description: campaignData.meta_description,
        url_slug: campaignData.slug
      },
      instagram_carousel: {
        caption: campaignData.social_caption_ig,
        prompts: campaignData.instagram_carousel_image_prompts
      },
      facebook: {
        copy: campaignData.social_caption_fb
      }
    };
    fs.writeFileSync(campaignJsonPath, JSON.stringify(campaignJsonData, null, 2));
    console.log(`✅ Saved Campaign JSON to: ${campaignJsonPath}`);

    // Update Supabase if we pulled a Supabase task
    if (supabase && task.id && !task.id.startsWith('local-')) {
      console.log(`[Supabase] Updating status of task ${task.id} to 'reviewing'...`);
      const { error: updateError } = await supabase
        .from('content_calendar')
        .update({
          blog_content: campaignData.blog_content,
          social_caption_ig: campaignData.social_caption_ig,
          social_caption_fb: campaignData.social_caption_fb,
          google_flow_media_url: heroImagePath,
          status: 'reviewing'
        })
        .eq('id', task.id);
      
      if (updateError) {
        console.error("❌ Supabase update failed:", updateError);
      } else {
        console.log("✅ Supabase task updated.");
      }
    }

    // Trigger Double-Loop review notifications
    await pingFounderForReview(task, campaignData.slug);

    // Trigger Social Posting Workflow (Simulation / API)
    await publishToMeta(campaignData, [heroImageFileName]);

    console.log("\n🎉 Full Campaign Generation Demo Finished successfully!\n");

  } catch (err) {
    console.error("❌ Error during campaign execution:", err);
  }
}

// Check command line arguments
const args = process.argv.slice(2);
let targetIndex = null;

if (args.includes('--article')) {
  const indexArg = args[args.indexOf('--article') + 1];
  targetIndex = parseInt(indexArg, 10);
}

// Immediately run
generateCampaign(targetIndex);
