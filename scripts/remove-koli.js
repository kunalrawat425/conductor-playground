const fs = require('fs');
const path = require('path');

const baseDir = '/Users/kunalrawat/conductor/workspaces/conductor-playground/da-nang';

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
  "FLOW-PROMPT.md"
];

// Order replacement patterns from most specific to least specific
const replacements = [
  { pattern: /Koli [Ss]ellers/g, replacement: 'Hyperlocal Sellers' },
  { pattern: /koli sellers/g, replacement: 'hyperlocal sellers' },
  { pattern: /Koli [Ff]ishing [Ff]amilies/g, replacement: 'Local Independent Fishing Families' },
  { pattern: /koli fishing families/g, replacement: 'local independent fishing families' },
  { pattern: /Koli [Ff]ishermen/g, replacement: 'Local Fishermen' },
  { pattern: /koli fishermen/g, replacement: 'local fishermen' },
  { pattern: /Koli [Ff]isherman/g, replacement: 'Local Fisherman' },
  { pattern: /koli fisherman/g, replacement: 'local fisherman' },
  { pattern: /Koli [Ff]isherwomen/g, replacement: 'Local Independent Fisherwomen' },
  { pattern: /koli fisherwomen/g, replacement: 'local independent fisherwomen' },
  { pattern: /Koli [Ww]oman/g, replacement: 'Local Independent Woman' },
  { pattern: /koli woman/g, replacement: 'local independent woman' },
  { pattern: /Koli [Ww]omen/g, replacement: 'Local Independent Women' },
  { pattern: /koli women/g, replacement: 'local independent women' },
  { pattern: /Koli [Ff]amily/g, replacement: 'Local Independent Family' },
  { pattern: /koli family/g, replacement: 'local independent family' },
  { pattern: /Koli [Ff]amilies/g, replacement: 'Local Independent Families' },
  { pattern: /koli families/g, replacement: 'local independent families' },
  { pattern: /Koli-style/g, replacement: 'Local-style' },
  { pattern: /koli-style/g, replacement: 'local-style' },
  { pattern: /Koli-fresh/g, replacement: 'Local-fresh' },
  { pattern: /koli-fresh/g, replacement: 'local-fresh' },
  { pattern: /Koliwada/g, replacement: 'Local fishing port' },
  { pattern: /koliwada/g, replacement: 'local fishing port' },
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

filesToProcess.forEach(relPath => {
  const filePath = path.join(baseDir, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  // Protect names
  const protectedPlaceholders = protectedNames.map((name, index) => {
    const placeholder = `__PROTECTED_NAME_${index}__`;
    // Escape regex characters just in case
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
    console.log(`Updated Koli references in: ${relPath}`);
  } else {
    console.log(`No changes needed in: ${relPath}`);
  }
});
