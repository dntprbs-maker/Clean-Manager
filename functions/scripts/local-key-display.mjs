// 키는 메모리에만 보관한다. URL·파일·표준출력으로 전달하지 않는다.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

export async function prepareLocalKeyDisplay({ openBrowser = true, ttl = 600_000, onDelivered = () => {} } = {}) {
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (openBrowser) await access(chrome);
  const route = "/" + randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  let key = null, delivered = false;
  const server = createServer((req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'`);
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403).end(); return;
    }
    if (req.url === route + "/close" && req.method === "POST") {
      key = null; res.end("닫혔습니다"); stop(); return;
    }
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    if (req.url === route + "/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ready: !!key, delivered })); return;
    }
    if (req.url === route + "/key") {
      if (!key) { res.writeHead(202).end(); return; }
      if (!delivered) onDelivered();
      delivered = true;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(key); return;
    }
    if (req.url !== route) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>지안 접속키 · 일회 전달</title>
<style>body{max-width:700px;margin:80px auto;font:18px sans-serif;padding:24px}textarea{width:100%;height:80px;font:20px monospace}button{padding:14px;margin:12px 8px 12px 0}p{line-height:1.6}</style>
<h1>지안 접속키 · 로컬 일회 표시</h1><p>이 화면은 이 PC에서만 열리는 임시 전달 화면입니다. 키 발급 관리 웹페이지가 아닙니다.<br>지안 연결 설정에 붙여넣은 뒤 아래 종료 버튼을 눌러 주세요. 10분 후 자동 종료됩니다.</p>
<textarea id="key" readonly spellcheck="false" autocomplete="off" aria-label="지안 접속키"></textarea><br>
<button id="copy">키 복사</button><button id="close">복사 완료 · 표시 종료</button><p id="status">발급 준비 중입니다.</p>
<script nonce="${nonce}">
const field=document.getElementById('key'),status=document.getElementById('status');
async function load(){try{const r=await fetch(location.pathname+'/key',{cache:'no-store'});if(r.status===202){setTimeout(load,500);return}if(!r.ok)throw Error();field.value=await r.text();status.textContent='지안 전용 키입니다. 채팅이나 문서에 붙여넣지 마세요.'}catch{field.value='';status.textContent='표시가 종료됐습니다.'}}
document.getElementById('copy').onclick=async()=>{if(!field.value)return;try{await navigator.clipboard.writeText(field.value);status.textContent='복사됐습니다. 지안 연결 설정에 붙여넣어 주세요.'}catch{field.select();status.textContent='선택된 키를 Ctrl+C로 복사해 주세요.'}};
document.getElementById('close').onclick=async()=>{field.value='';await fetch(location.pathname+'/close',{method:'POST'});status.textContent='표시가 종료됐습니다. 창을 닫아 주세요.'};
window.addEventListener('pagehide',()=>{field.value=''});setTimeout(()=>{field.value='';status.textContent='표시 시간이 종료됐습니다.'},600000);load();
</script></html>`);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}${route}`;
  const timer = setTimeout(stop, ttl);
  function stop() { key = null; clearTimeout(timer); server.close(); server.closeAllConnections(); }
  if (openBrowser) {
    const child = spawn(chrome, ["--new-window", url], { stdio: "ignore", detached: true });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }).catch(e => { stop(); throw e; });
    child.unref();
  }
  return { show(value) { key = value; }, stop, url };
}
