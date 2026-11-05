export function MoreRows({ count, hasMore, onMore, loading }) {
  return <div className="px-4 py-4 text-center text-xs text-gray-500">
    <span>현재 {count}건 표시</span>
    {hasMore && <button disabled={loading} onClick={onMore} className="ml-3 px-5 py-2 rounded-xl border border-gray-200 bg-white font-bold text-blue-700 disabled:opacity-50">{loading ? '확인 중…' : '20건 더 보기'}</button>}
  </div>;
}
