const fs = require('fs');
const path = require('path');

const baseDir = '/Users/kunalrawat/conductor/workspaces/conductor-playground/da-nang';
const brainDir = '/Users/kunalrawat/.gemini/antigravity-ide/brain/a7ea5348-a0d6-441d-9029-8a04312110ac';

const filesToProcess = [
  "src/pages/blog/index.astro",
  "src/pages/for-sellers.astro",
  "src/pages/terms.astro",
  "src/layouts/Layout.astro",
  "BRAND-VOICE.md",
  "scripts/generate-realistic-creatives.js",
  "scripts/generate-mega-playbook.py",
  "scripts/meta-api.js",
  "scripts/generate-missing-creatives.js",
  "scripts/playbook_parts/creative.txt",
  "scripts/auto-blogger.js",
  "scripts/playbook_parts/brand.txt",
  "scripts/playbook_parts/growth.txt",
  "scripts/playbook_parts/launch.txt",
  "scripts/playbook_parts/pricing.txt",
  "scripts/playbook_parts/missing_chapters.txt",
  "scripts/playbook_parts/content.txt",
  "scripts/playbook_parts/ads.txt",
  "scripts/playbook_parts/seo.txt",
  "public/assets/campaigns/demo-campaign.json",
  "IMAGEN-PROMPTS.md",
  "public/assets/campaigns/sunday-fish-problem-mumbai-thane-fixed.json",
  "public/ig-previews.html",
  "public/pitch-deck-v3-final.html",
  "public/reel-carousel-scripts.html",
  "public/pitch-deck-ultra.html",
  "public/seller-onboard.html",
  "public/social-preview.html",
  "public/prompt-preview.html",
  "supabase/run-me.sql",
  "public/campaign-creatives.html",
  "SOCIAL-CALENDAR.md",
  "AD-CAMPAIGNS.md",
  "FLOW-PROMPT.md",
  ".agents/product-marketing-context.md",
  ".agents/hyperlocal-trust-engine.md",
  ".agents/ad-creative.md",
  ".agents/seo-content-engine.md",
  ".agents/paid-ads.md",
  ".agents/social-content.md",
  ".agents/automation-master-plan.md",
  ".agents/launch-strategy.md",
  ".agents/master-content-prompt.md"
];

const brainFiles = [
  "implementation_plan.md",
  "walkthrough.md",
  "task.md"
];

// Order replacement patterns from most specific context to least specific
const replacements = [
  { pattern: /local koli sellers/gi, replacement: 'local independent sellers' },
  { pattern: /local Koli sellers/gi, replacement: 'local independent sellers' },
  { pattern: /local Koli fish sellers/gi, replacement: 'local independent fish sellers' },
  { pattern: /koli sellers/gi, replacement: 'hyperlocal sellers' },
  { pattern: /Koli [Ss]ellers/gi, replacement: 'Hyperlocal Sellers' },
  { pattern: /traditional Koli fishing families/gi, replacement: 'local independent fishing families' },
  { pattern: /traditional Koli fishing family/gi, replacement: 'local independent fishing family' },
  { pattern: /Koli fishing families/gi, replacement: 'local independent fishing families' },
  { pattern: /koli fishing families/gi, replacement: 'local independent fishing families' },
  { pattern: /Koli [Ff]ishing [Ff]amily/gi, replacement: 'Local Independent Fishing Family' },
  { pattern: /koli fishing family/gi, replacement: 'local independent fishing family' },
  { pattern: /Koli [Ff]ishermen/gi, replacement: 'local fishermen' },
  { pattern: /koli fishermen/gi, replacement: 'local fishermen' },
  { pattern: /Koli [Ff]isherman/gi, replacement: 'local fisherman' },
  { pattern: /koli fisherman/gi, replacement: 'local fisherman' },
  { pattern: /Koli [Ff]isherwomen/gi, replacement: 'local independent fisherwomen' },
  { pattern: /koli fisherwomen/gi, replacement: 'local independent fisherwomen' },
  { pattern: /Koli [Ww]oman/gi, replacement: 'local independent woman' },
  { pattern: /koli woman/gi, replacement: 'local independent woman' },
  { pattern: /Koli [Ww]omen/gi, replacement: 'local independent women' },
  { pattern: /koli women/gi, replacement: 'local independent women' },
  { pattern: /Koli [Ff]amily/gi, replacement: 'local independent family' },
  { pattern: /koli family/gi, replacement: 'local independent family' },
  { pattern: /Koli [Ff]amilies/gi, replacement: 'local independent families' },
  { pattern: /koli families/gi, replacement: 'local independent families' },
  { pattern: /Koli [Ff]isherfolk/gi, replacement: 'local independent fisherfolk' },
  { pattern: /koli fisherfolk/gi, replacement: 'local independent fisherfolk' },
  { pattern: /Koli-style/gi, replacement: 'local-style' },
  { pattern: /koli-style/gi, replacement: 'local-style' },
  { pattern: /Koli-fresh/gi, replacement: 'local-fresh' },
  { pattern: /koli-fresh/gi, replacement: 'local-fresh' },
  { pattern: /Koliwada/gi, replacement: 'local fishing port' },
  { pattern: /koliwada/gi, replacement: 'local fishing port' },
  { pattern: /Koli/g, replacement: 'Hyperlocal' },
  { pattern: /koli/g, replacement: 'hyperlocal' },
  { pattern: /KOLI/g, replacement: 'HYPERLOCAL' }
];

// Names to protect
const protectedNames = [
  'Ramesh Koli',
  'Vinod Koli',
  'ramesh koli',
  'vinod koli'
];

function processFile(filePath, displayPath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  // Protect names
  const protectedPlaceholders = protectedNames.map((name, index) => {
    const placeholder = `__PROTECTED_NAME_${index}__`;
    const regex = new RegExp(name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    content = content.replace(regex, placeholder);
    return { name, placeholder };
  });
  
  // Apply Koli replacements
  replacements.forEach(({ pattern, replacement }) => {
    content = content.replace(pattern, replacement);
  });
  
  // Restore names
  protectedPlaceholders.forEach(({ name, placeholder }) => {
    content = content.replace(new RegExp(placeholder, 'g'), name);
  });
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated Koli references in: ${displayPath}`);
  } else {
    console.log(`No changes needed in: ${displayPath}`);
  }
}

// Process codebase files
filesToProcess.forEach(relPath => {
  const filePath = path.join(baseDir, relPath);
  processFile(filePath, relPath);
});

// Process brain artifacts
brainFiles.forEach(relPath => {
  const filePath = path.join(brainDir, relPath);
  processFile(filePath, `[brain]/${relPath}`);
});
