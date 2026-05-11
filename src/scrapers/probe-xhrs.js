// Diagnostic: navigate to a Google Maps view and dump every maps-flavoured XHR
// URL that fires. Use this to find the endpoint Google actually uses today
// for reviews / photos / details.
//
// Usage:
//   node src/scrapers/probe-xhrs.js <url>
// Example:
//   node src/scrapers/probe-xhrs.js 'https://www.google.com/maps/place/data=!4m7!3m6!1s0x14f99d583f1f52b7:0x6141bf6ad1be1b58!5m2!4m1!1i2!9m1!1b1?hl=en'

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node src/scrapers/probe-xhrs.js <url>');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  timezoneId: 'Africa/Cairo',
});
const page = await context.newPage();

const captures = [];
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/google\.com\/maps|google\.com\/search\?.*tbm=map/.test(u)) return;
  try {
    const text = await resp.text();
    if (text.length < 200) return;
    captures.push({ url: u, length: text.length, body: text });
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const el = document.querySelector('[role="main"]');
  if (el) el.scrollBy(0, 3000);
});
await page.waitForTimeout(2000);

await browser.close();

await mkdir('raw/probe', { recursive: true });
console.log(`\nCaptured ${captures.length} maps XHRs:`);
for (let i = 0; i < captures.length; i++) {
  const c = captures[i];
  const path = c.url.split('?')[0].replace('https://www.google.com', '');
  console.log(`  [${i}] ${c.length.toString().padStart(7)}B  ${path}`);
  await writeFile(`raw/probe/cap-${i}.url`, c.url);
  await writeFile(`raw/probe/cap-${i}.body`, c.body);
}
