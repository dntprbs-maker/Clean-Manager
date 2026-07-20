import { useState } from 'react';
import { registerFirstAdmin, storeUser } from '../lib/auth';

export default function SetupScreen({ onLogin }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !id.trim() || pw.length < 4) {
      setError('이름, 아이디를 입력하고 비밀번호는 4자 이상으로 해주세요.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const user = await registerFirstAdmin({ id, pw, name });
      storeUser(user);
      onLogin(user);
    } catch (err) {
      setError(err.message || '계정 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 w-full space-y-3">
        <h1 className="text-lg font-semibold text-center mb-2">최초 관리자 계정 만들기</h1>
        <p className="text-xs text-gray-400 text-center mb-4">아직 계정이 없습니다. 대표(최고관리자) 계정을 먼저 만들어주세요.</p>
        <input className="border rounded px-3 py-2 w-full" placeholder="이름"
          value={name} onChange={(e) => setName(e.target.value)} />
        <input className="border rounded px-3 py-2 w-full" placeholder="아이디"
          value={id} onChange={(e) => setId(e.target.value)} />
        <input type="password" className="border rounded px-3 py-2 w-full" placeholder="비밀번호 (4자 이상)"
          value={pw} onChange={(e) => setPw(e.target.value)} />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={loading} className="bg-blue-600 text-white rounded px-4 py-2 w-full disabled:opacity-50">
          {loading ? '만드는 중...' : '계정 만들고 시작하기'}
        </button>
      </form>
    </div>
  );
}
