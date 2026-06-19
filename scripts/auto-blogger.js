import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';

// Load env vars from .env and .env.local
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  console.error("Missing required environment variables (Supabase or Gemini API Key).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MASTER_PROMPT_TEMPLATE = `
You are the Chief Brand Officer, Consumer Psychologist, Hyperlocal Growth Lead, and Master Copywriter for Relifish.

Your objective is to compile a complete, high-converting content marketing bundle (Blog post + Social assets + Email + WhatsApp broadcasts) for a target Topic and Key Phrase.

Context:
Relifish is a hyperlocal seafood marketplace in Thane (serving Hiranandani Estate, Ghodbunder Road, Majiwada, Kasarvadavali). We connect buyers directly to local fishermen and Koli sellers. We operate as the "Freshness Trust Layer," solving the bad trade-off between convenience (which usually means stale, warehouse-stored fish with a 30% delivery app markup) and freshness (which usually means waking up at 6 AM to visit a smelly local mandi).

Psychological & Persuasion Levers to Apply:
- Loss Aversion: Frame supermarket/app fish not just as "less fresh," but as a loss of family health, weekend time, and hard-earned money (30% markup).
- Regret Aversion (Risk Relief): Proactively dismantle the "Will my kitchen smell?" and "Is this chemically treated?" anxieties. Highlight the Freshness Score and the 100% Odour-Free refund guarantee.
- Human Trust & Emojis/Icons: Incorporate visual, sophisticated trust badges (e.g., ✅ Genuinely Fresh / Never Frozen, 🛵 2-Hour Doorstep Delivery, ⭐ 4.8+ Rated Koli Sellers, 💬 WhatsApp support).

Inputs:
- [Topic]: {topic}
- [Primary Keyword]: {keywords}
- [Target Locality]: {locality}

Output your response strictly as a JSON object with the following keys:
{
  "slug": "url-friendly-slug",
  "meta_title": "string",
  "meta_description": "string",
  "blog_content": "Full markdown string of the blog (800-1200 words, starting directly with hook)",
  "whatsapp_broadcast": "Hinglish whatsapp copy string",
  "instagram_caption": "Caption for IG with hashtags",
  "facebook_caption": "Caption for FB",
  "image_prompts": ["Prompt 1", "Prompt 2"]
}
`;

async function generateCampaign() {
  console.log("Checking for pending content generation tasks...");
  
  // 1. Fetch pending content from Supabase
  const { data: records, error } = await supabase
    .from('content_calendar')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(1);

  if (error) {
    console.error("Error fetching from Supabase:", error);
    return;
  }

  if (!records || records.length === 0) {
    console.log("No pending tasks found.");
    return;
  }

  const task = records[0];
  console.log(`Generating content for Topic: "${task.topic}"...`);

  try {
    // 2. Prepare Prompt
    const prompt = MASTER_PROMPT_TEMPLATE
      .replace('{topic}', task.topic)
      .replace('{keywords}', (task.keywords || []).join(', '))
      .replace('{locality}', task.target_locality || 'Thane');

    // 3. Call Gemini
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash', 
      generationConfig: { responseMimeType: "application/json" } 
    });
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const campaignData = JSON.parse(text);

    // 4. Save Blog Content locally (to trigger Astro build)
    const blogDir = path.join(process.cwd(), 'src/content/blog');
    if (!fs.existsSync(blogDir)) {
      fs.mkdirSync(blogDir, { recursive: true });
    }
    
    // Frontmatter preparation
    const frontmatter = \`---
title: "\${campaignData.meta_title.replace(/"/g, '\\"')}"
description: "\${campaignData.meta_description.replace(/"/g, '\\"')}"
date: "\${new Date().toISOString()}"
author: "Relifish Team"
image: "\${task.google_flow_media_url || '/placeholder.jpg'}"
locality: "\${task.target_locality || 'Thane'}"
---

\`;

    const blogPath = path.join(blogDir, \`\${campaignData.slug}.md\`);
    fs.writeFileSync(blogPath, frontmatter + campaignData.blog_content);
    console.log(\`Saved blog to \${blogPath}\`);

    // 5. Update Supabase record
    const { error: updateError } = await supabase
      .from('content_calendar')
      .update({
        blog_content: campaignData.blog_content,
        social_caption_ig: campaignData.instagram_caption,
        social_caption_fb: campaignData.facebook_caption,
        status: 'reviewing' // Moving to Human-in-the-loop review
      })
      .eq('id', task.id);

    if (updateError) {
      console.error("Error updating Supabase:", updateError);
      return;
    }

    // 6. Loop 1 Verification: WhatsApp Ping to Founder
    await pingFounderForReview(task, campaignData.slug);

    console.log("Campaign generation complete! Status set to 'reviewing'.");

  } catch (err) {
    console.error("Error during generation:", err);
  }
}

// Dummy WhatsApp integration for pinging the founder 24 hours prior
async function pingFounderForReview(task, slug) {
  console.log("-----------------------------------------");
  console.log("🔔 [WhatsApp Ping] To Founder:");
  console.log(\`New campaign ready for review: \${task.topic}\`);
  console.log(\`Draft Location: src/content/blog/\${slug}.md\`);
  console.log(\`Action Required: Approve in Supabase to trigger auto-publishing to Socials.\`);
  console.log("-----------------------------------------");
  // In a real scenario, integrate Twilio / Meta WhatsApp Business API here
}

// Schedule the cron job to run every morning at 6:00 AM
console.log("Starting Auto-Blogger Cron Service...");
cron.schedule('0 6 * * *', () => {
  generateCampaign();
});

// Also run once immediately for testing if invoked directly
if (require.main === module) {
  generateCampaign();
}
