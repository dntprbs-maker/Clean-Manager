// -------------------------------------------------
// 웹디자이너 AI 호출 스크립트
// OpenRouter(https://openrouter.ai)를 통해 디자인 리뷰를 요청한다.
// ⚠️ 자동 호출 금지 — "아빠"가 "웹디자이너한테 물어봐" 등으로 명시적으로 요청했을 때만,
//    그리고 실행 직전에 "지금 웹디자이너 API 부를 건데 진행할까?" 확인을 받은 뒤에만 실행할 것.
// -------------------------------------------------
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { pathToFileURL } from 'url';

process.loadEnvFile('.env');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.WEBDESIGNER_MODEL || 'openai/gpt-4o';
const API_KEY = process.env.OPENROUTER_API_KEY_WEBDESIGNER;

function parseArgs(argv) {
  const args = { files: [], prompt: '', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') args.files.push(argv[++i]);
    else if (a === '--prompt' || a === '-p') args.prompt = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
  }
  return args;
}

export async function callWebDesigner({ prompt, files = [], model = MODEL }) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY_WEBDESIGNER가 .env에 없습니다.');
  if (!prompt) throw new Error('prompt가 필요합니다.');

  const fileBlocks = files.map((path) => {
    const content = readFileSync(path, 'utf-8');
    const ext = path.split('.').pop();
    return `### ${basename(path)}\n\`\`\`${ext}\n${content}\n\`\`\``;
  });

  const userContent = [prompt, ...fileBlocks].join('\n\n');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '당신은 시니어 프로덕트 디자이너입니다. 모바일 웹앱 UI/UX를 리뷰하고 구체적인 개선안을 한국어로 제시하세요.' },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API 오류 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);
}

// CLI로 직접 실행됐을 때만 동작 (다른 스크립트에서 callWebDesigner를 import해서 쓸 수도 있음)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { prompt, files, out } = parseArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('사용법: node call-webdesigner.mjs --prompt "리뷰 요청 내용" --file path/to/File.jsx [--file another.jsx] [--out result.md]');
    process.exit(1);
  }
  const result = await callWebDesigner({ prompt, files });
  console.log(result);
  if (out) {
    writeFileSync(out, result, 'utf-8');
    console.log(`\n(결과를 ${out}에 저장했습니다)`);
  }
}
