// -------------------------------------------------
// 웹디자이너 비전 코드생성 스크립트 (OpenRouter, 이미지 입력 → 코드 출력)
// ⚠️ 자동 호출 금지 — 명시적 요청 + 실행 전 확인 후에만 사용 (call-webdesigner.mjs와 동일한 규칙)
// -------------------------------------------------
import { readFileSync, writeFileSync } from 'fs';
import { extname } from 'path';

process.loadEnvFile('.env');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY_WEBDESIGNER;

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function parseArgs(argv) {
  const args = { model: 'x-ai/grok-build-0.1', image: null, prompt: '', outPrefix: 'webdesigner-code', count: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') args.model = argv[++i];
    else if (a === '--image' || a === '-i') args.image = argv[++i];
    else if (a === '--prompt' || a === '-p') args.prompt = argv[++i];
    else if (a === '--out' || a === '-o') args.outPrefix = argv[++i];
    else if (a === '--count' || a === '-n') args.count = parseInt(argv[++i], 10);
  }
  return args;
}

async function callOnce({ model, image, prompt }) {
  const content = [{ type: 'text', text: prompt }];
  if (image) {
    const ext = extname(image).toLowerCase();
    const mime = MIME[ext] || 'image/png';
    const base64 = readFileSync(image).toString('base64');
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`OpenRouter API 오류 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);
}

function extractHtml(text) {
  const match = /```html\s*([\s\S]*?)```/i.exec(text);
  return match ? match[1].trim() : text;
}

const { model, image, prompt, outPrefix, count } = parseArgs(process.argv.slice(2));
if (!API_KEY) throw new Error('OPENROUTER_API_KEY_WEBDESIGNER가 .env에 없습니다.');
if (!prompt) {
  console.error('사용법: node generate-webdesigner-code.mjs --image path.png --prompt "설명" [--model x-ai/grok-build-0.1] [--out prefix] [--count 2]');
  process.exit(1);
}

for (let i = 1; i <= count; i++) {
  console.log(`[${i}/${count}] ${model} 호출 중...`);
  const raw = await callOnce({ model, image, prompt });
  const html = extractHtml(raw);
  const outFile = `${outPrefix}-${i}.html`;
  writeFileSync(outFile, html, 'utf-8');
  console.log('저장:', outFile, `(${html.length}자)`);
}
