/** Render the source card with an installed Playwright/browser. No app server required.
 * Usage: node scripts/render-brand.cjs
 * Optional: THREADRIFT_PLAYWRIGHT_MODULE=/absolute/path/to/playwright
 */
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let chromium;
try {
  ({chromium}=require(process.env.THREADRIFT_PLAYWRIGHT_MODULE || 'playwright'));
} catch (error) {
  console.error('Playwright is required to regenerate the artwork. See assets/brand/README.md for setup.');
  console.error(error.message);
  process.exit(1);
}
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({
    ...(process.env.THREADRIFT_BROWSER_CHANNEL ? {channel:process.env.THREADRIFT_BROWSER_CHANNEL} : {}),
    headless:true,
  });
  try{
    const page=await browser.newPage({viewport:{width:1600,height:880},deviceScaleFactor:1});
    for(const theme of ['dark','light']){
      await page.goto(pathToFileURL(path.join(root,'assets/brand/readme-card.html')).href+'?theme='+theme);
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
      await page.locator('.card').screenshot({path:path.join(root,`assets/brand/readme-${theme}.png`)});
      console.log(`Rendered readme-${theme}.png`);
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
