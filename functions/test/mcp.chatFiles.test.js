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

test('실제 ChatGPT 일본 리전 파일 저장소만 허용하며 임의 Azure 저장소는 거부', async () => {
 const real={...file,download_url:'https://oaisdmntprjapaneast.blob.core.windows.net/test'};
 const result=await downloadChatPhotos([real],async()=>new Response(png));
 assert.equal(result[0].mimeType,'image/png');
 await assert.rejects(downloadChatPhotos([{...file,download_url:'https://evil.blob.core.windows.net/test'}]),/호스트/);
});

test('호주 동부 첨부 저장소 허용 및 유사 호스트 차단', async () => {
 const host = 'oaisdmntpraustraliaeast.blob.core.windows.net';
 let calls = 0;
 const result = await downloadChatPhotos([{...file, download_url:`https://${host}/test`}], async (_url, opts) => { calls++; assert.equal(opts.redirect, 'error'); return new Response(png); });
 assert.equal(calls, 1);
 assert.equal(result[0].dataBase64, png.toString('base64'));
 for (const url of [`https://${host}.evil.com/test`, 'https://evil.blob.core.windows.net/test', 'https://oaisdmntpraustraliaeast2.blob.core.windows.net/test', `http://${host}/test`, `https://user@${host}/test`, `https://${host}:444/test`]) {
  await assert.rejects(downloadChatPhotos([{...file,download_url:url}], async () => { throw Error('호출되면 안 됨'); }), /호스트/);
 }
});
test('미국 서부 첨부 저장소는 허용하고 유사 주소는 다운로드 전에 거부', async () => {
 const host = 'oaisdmntprwestus.blob.core.windows.net';
 const result = await downloadChatPhotos([{...file, download_url:`https://${host}/test`}], async (_url, opts) => { assert.equal(opts.redirect, 'error'); return new Response(png); });
 assert.equal(result[0].dataBase64, png.toString('base64'));
 for (const url of [`https://${host}.evil.com/test`, 'https://evil.blob.core.windows.net/test', 'https://oaisdmntprwestus2.blob.core.windows.net/test', `http://${host}/test`, `https://user@${host}/test`, `https://${host}:444/test`]) {
  let called = false;
  await assert.rejects(downloadChatPhotos([{...file,download_url:url}], async () => { called=true; throw Error('unexpected'); }), /호스트/);
  assert.equal(called, false);
 }
});