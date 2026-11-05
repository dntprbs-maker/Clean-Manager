export function DataSyncBanner({ states, retry, lastConfirmedAt }) {
  const items = Object.values(states);
  if (!items.length || items.every(s => s.ready)) return lastConfirmedAt ? <div className="text-[10px] text-gray-400 text-center">서버 확인 {new Date(lastConfirmedAt).toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul"})}</div> : null;
  const error = items.some(s => s.error);
  return <div role={error ? 'alert' : 'status'} className="px-3 py-2 text-xs text-center bg-amber-50 text-amber-900">
    {error ? '자료를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.' : '서버 자료 확인 중입니다. 확인이 끝나기 전에는 금액을 확정할 수 없습니다.'}
    {error && <button onClick={retry} className="ml-2 underline font-bold">다시 확인</button>}
  </div>;
}
