import { z } from 'zod';

// ChatGPT fileParams requires these four declared properties.
export const CHAT_FILE = z.object({
  download_url: z.string().min(1).max(8192),
  file_id: z.string().min(1).max(512),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});
const MAX = 10 * 1024 * 1024;
function imageType(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['GIF87a','GIF89a'].includes(b.subarray(0,6).toString())) return 'image/gif';
  if (b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  throw Error('첨부 파일이 지원되는 이미지가 아닙니다. JPG·PNG·WEBP·GIF를 첨부해주세요.');
}
export async function downloadChatPhotos(files, fetcher = fetch) {
  if (!files?.length || files.length > 20) throw Error('사진은 1~20장까지 전달해주세요.');
  const result = []; let total = 0;
  for (const file of files) {
    let url;
    try { url = new URL(file.download_url); } catch { throw Error('ChatGPT 파일 다운로드 주소가 없습니다. 사진을 다시 첨부해주세요.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'oaisdmntprjapaneast.blob.core.windows.net' || url.hostname === 'files.oaiusercontent.com' || url.hostname.endsWith('.oaiusercontent.com'))) {
      throw Error(`ChatGPT 첨부파일 호스트가 허용되지 않았습니다 (${url.hostname.slice(0,200)}). 관리자에게 이 호스트만 전달해주세요. 다운로드 전체 주소는 공유하지 마세요.`);
    }
    let response;
    try { response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw Error('첨부파일 다운로드에 실패했습니다. 사진을 다시 첨부해주세요.'); }
    if (!response.ok || !response.body) throw Error('첨부파일 주소가 만료되었거나 다운로드할 수 없습니다. 사진을 다시 첨부해주세요.');
    if (Number(response.headers.get('content-length')) > MAX) { await response.body.cancel(); throw Error('사진은 장당 10MB 이하여야 합니다.'); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; total += value.length;
        if (size > MAX || total > 20 * 1024 * 1024) throw Error('사진은 장당 10MB, 합계 20MB 이하여야 합니다.');
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw Error(error.message.includes('MB') ? error.message : '사진 다운로드가 중단되었습니다. 다시 첨부해주세요.'); }
    finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks), mimeType = imageType(bytes);
    const extension = mimeType.split('/')[1].replace('jpeg','jpg');
    result.push({ name: (file.file_name || `chat-photo-${result.length + 1}.${extension}`).slice(0,200), mimeType, dataBase64: bytes.toString('base64') });
  }
  return result;
}
