// HTML 슬라이드/도식을 PNG 이미지로 변환한다.
// 사용법: node tools/render.mjs images/html/파일.html [더 많은 파일...]
// 결과: images/generated/파일.png (가로 1920, 2배 해상도)
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('사용법: node tools/render.mjs images/html/파일.html');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
for (const file of files) {
  await page.goto(pathToFileURL(resolve(file)).href);
  await page.evaluate(() => document.fonts.ready);
  const out = `images/generated/${basename(file, '.html')}.png`;
  // 슬라이드는 1080 고정, 대시보드 시안처럼 긴 화면은 전체 높이로 저장
  await page.screenshot({ path: out, fullPage: true });
  console.log(`저장: ${out}`);
}
await browser.close();
