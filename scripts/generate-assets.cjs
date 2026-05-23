const { chromium } = require('/Users/kunalrawat/conductor/workspaces/conductor-playground/da-nang/.claude/skills/gstack/node_modules/playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  // 1. Flyer → PDF
  {
    const page = await context.newPage();
    const flyerPath = path.resolve(__dirname, '../public/flyer.html');
    await page.goto(`file://${flyerPath}`);
    await page.waitForLoadState('networkidle');
    await page.pdf({
      path: path.resolve(__dirname, '../public/flyer.pdf'),
      printBackground: true,
      format: 'A5',
    });
    await page.close();
    console.log('✓ flyer.pdf generated');
  }

  // 1b. Single Page Flyer → PDF
  {
    const page = await context.newPage();
    const flyerPath = path.resolve(__dirname, '../public/single-page-flyer.html');
    await page.goto(`file://${flyerPath}`);
    await page.waitForLoadState('networkidle');
    await page.pdf({
      path: path.resolve(__dirname, '../public/single-page-flyer.pdf'),
      printBackground: true,
      format: 'A5',
    });
    await page.close();
    console.log('✓ single-page-flyer.pdf generated');
  }

  // 2. FB Cover image (820x312)
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 820, height: 312 });
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 820px; height: 312px; overflow: hidden;
    background: linear-gradient(135deg, #0f4c35 0%, #1a7a52 40%, #22a869 70%, #f97316 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 60px;
  }
  .left { display: flex; flex-direction: column; gap: 12px; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .fish { font-size: 64px; }
  .name {
    font-size: 52px; font-weight: 800; color: #fff;
    letter-spacing: -1px; line-height: 1;
  }
  .name span { color: #fbbf24; }
  .tagline {
    font-size: 18px; color: rgba(255,255,255,0.85);
    font-weight: 400; letter-spacing: 0.5px;
  }
  .right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .badge {
    background: rgba(255,255,255,0.15); backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 12px; padding: 10px 20px;
    color: #fff; font-size: 14px; font-weight: 600;
    text-align: center;
  }
  .badge .emoji { font-size: 20px; display: block; margin-bottom: 4px; }
</style>
</head>
<body>
  <div class="left">
    <div class="brand">
      <span class="fish">🐟</span>
      <div class="name">Reli<span>fish</span></div>
    </div>
    <div class="tagline">Fresh local seafood · Same-day delivery</div>
  </div>
  <div class="right">
    <div class="badge"><span class="emoji">🦀</span>Live Dungeness Crab</div>
    <div class="badge"><span class="emoji">🐟</span>Wild-caught daily</div>
    <div class="badge"><span class="emoji">📦</span>Pre-order available</div>
  </div>
</body>
</html>`;
    await page.setContent(html);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: path.resolve(__dirname, '../public/fb-cover.png'),
      clip: { x: 0, y: 0, width: 820, height: 312 },
    });
    await page.close();
    console.log('✓ fb-cover.png generated');
  }

  // 3. Logo (512x512 transparent)
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 512, height: 512 });
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 512px; height: 512px; overflow: hidden;
    background: transparent;
    display: flex; align-items: center; justify-content: center;
  }
  .logo {
    width: 480px; height: 480px;
    background: linear-gradient(145deg, #0f4c35, #1a7a52);
    border-radius: 96px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }
  .fish { font-size: 200px; line-height: 1; }
  .name {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 58px; font-weight: 800; color: #fff;
    letter-spacing: -1px;
  }
  .name span { color: #fbbf24; }
</style>
</head>
<body>
  <div class="logo">
    <div class="fish">🐟</div>
    <div class="name">Reli<span>fish</span></div>
  </div>
</body>
</html>`;
    await page.setContent(html);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: path.resolve(__dirname, '../public/logo-512.png'),
      omitBackground: true,
    });
    await page.close();
    console.log('✓ logo-512.png generated');
  }

  await browser.close();
  console.log('\nAll assets generated in public/');
}

run().catch(err => { console.error(err); process.exit(1); });
