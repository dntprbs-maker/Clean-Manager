import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadChatPhotos } from '../mcp/lib/chatFiles.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const file = { file_id: 'file-test', download_url: 'https://files.oaiusercontent.com/test', file_name: 'test.png' };
test('클라우드 사진은 실제 바이트로 변환되고 임시 URL은 저장 데이터에서 제외', async () => {
 const result = await downloadChatPhotos([file], async (url, opts) => { assert.equal(opts.redirect,'error'); return new Response(png); });
 assert.equal(result[0].dataBase64,png.toString('base64')); assert.equal(result[0].mimeType,'image/png'); assert.equal(result[0].url,undefined);
});
test('임의 호스트, 내부 주소, 사용자정보, HTTP, 포트 거부', async () => {
 for (const url of ['http://files.oaiusercontent.com/x','https://127.0.0.1/x','https://files.oaiusercontent.com.evil.com/x','https://user@files.oaiusercontent.com/x','https://files.oaiusercontent.com:444/x']) {
  await assert.rejects(downloadChatPhotos([{...file,download_url:url}],()=>{ throw Error('호출되면 안 됨'); }),/호스트/);
 }
});
test('만료, 비이미지, 크기 초과, 리다이렉트 실패 처리', async () => {
 await assert.rejects(downloadChatPhotos([file],async()=>new Response('',{status:403})),/만료/);
 await assert.rejects(downloadChatPhotos([file],async()=>new Response('<html>')),/이미지/);
 await assert.rejects(downloadChatPhotos([file],async()=>new Response(png,{headers:{'content-length':String(11*1024*1024)}})),/10MB/);
 await assert.rejects(downloadChatPhotos([file],async()=>{throw Error('redirect');}),/다운로드/);
});
