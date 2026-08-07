// -------------------------------------------------
// 웹디자이너 이미지 생성 스크립트 (OpenRouter, 이미지 생성 모델 전용)
// ⚠️ 자동 호출 금지 — 명시적 요청 + 실행 전 확인 후에만 사용 (call-webdesigner.mjs와 동일한 규칙)
// -------------------------------------------------
import { writeFileSync } from 'fs';

process.loadEnvFile('.env');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY_WEBDESIGNER;
const MODEL = process.argv[2] || 'google/gemini-3-pro-image';
const PROMPT = process.argv[3];
const OUT_HTML = process.argv[4] || 'webdesigner-image-result.html';

if (!API_KEY) throw new Error('OPENROUTER_API_KEY_WEBDESIGNER가 .env에 없습니다.');
if (!PROMPT) {
  console.error('사용법: node generate-webdesigner-image.mjs <model> "<prompt>" [out.html]');
  process.exit(1);
}

const res = await fetch(API_URL, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: PROMPT }],
  }),
});

if (!res.ok) {
  const text = await res.text();
  throw new Error(`OpenRouter API 오류 (${res.status}): ${text}`);
}

const data = await res.json();
const msg = data.choices?.[0]?.message;
if (!msg) throw new Error('응답에 message가 없습니다: ' + JSON.stringify(data, null, 2));

const images = msg.images || [];
const savedFiles = [];

images.forEach((img, i) => {
  const url = img.image_url?.url || img.url;
  if (!url) return;
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(url);
  if (!match) { savedFiles.push({ url }); return; } // 외부 URL인 경우
  const [, ext, base64] = match;
  const filename = `webdesigner-image-${i + 1}.${ext}`;
  writeFileSync(filename, Buffer.from(base64, 'base64'));
  savedFiles.push({ filename });
  console.log('이미지 저장:', filename);
});

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>웹디자이너 이미지 결과</title>
<style>body{background:#111;margin:0;padding:32px;display:flex;flex-direction:column;align-items:center;gap:24px;font-family:sans-serif;color:#eee}
img{max-width:420px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
pre{max-width:600px;white-space:pre-wrap;background:#1e1e1e;padding:16px;border-radius:8px;font-size:13px}</style>
</head><body>
<h2>모델: ${MODEL}</h2>
${savedFiles.map((f) => f.filename ? `<img src="${f.filename}" alt="webdesigner result">` : `<img src="${f.url}" alt="webdesigner result">`).join('\n')}
${msg.content ? `<pre>${msg.content.replace(/</g, '&lt;')}</pre>` : ''}
</body></html>`;

writeFileSync(OUT_HTML, html, 'utf-8');
console.log('HTML 저장:', OUT_HTML);
if (!images.length) console.log('(주의) 이미지가 응답에 없었습니다. 텍스트 응답만 저장됨:', msg.content?.slice(0, 200));
