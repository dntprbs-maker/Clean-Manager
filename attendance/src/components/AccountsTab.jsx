import { useEffect, useState } from 'react';
import { subscribeAccounts, createAccount, setAccountActive } from '../lib/accounts';
import { canApproveAsAdmin } from '../lib/membership';

const EMPTY_FORM = { name: '', id: '', pw: '', role: '매니저' };

export default function AccountsTab({ currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => subscribeAccounts(setAccounts), []);

  if (!canApproveAsAdmin(currentUser)) {
    return <div className="p-4 text-sm text-gray-400">대표(최고관리자)만 접근할 수 있습니다.</div>;
  }

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.id.trim() || form.pw.length < 4) {
      setError('이름, 아이디를 입력하고 비밀번호는 4자 이상으로 해주세요.');
      return;
    }
    if (accounts.some((a) => a.id === form.id.trim())) {
      setError('이미 사용 중인 아이디입니다.');
      return;
    }
    await createAccount(form);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-1">계정 관리</h2>
      <p className="text-xs text-gray-400 mb-3">매니저·대표 계정만 여기서 만듭니다. 직원(용역자) 로그인은 "직원 관리"에서 전화번호로 등록하면 자동으로 됩니다.</p>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-2 bg-white p-3 rounded-lg border items-center">
        <select className="border rounded px-2 py-1" value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="매니저">매니저</option>
          <option value="최고관리자">최고관리자(대표)</option>
        </select>
        <input className="border rounded px-2 py-1 flex-1 min-w-[100px]" placeholder="이름"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="border rounded px-2 py-1 flex-1 min-w-[100px]" placeholder="아이디"
          value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input type="password" className="border rounded px-2 py-1 flex-1 min-w-[100px]" placeholder="비밀번호"
          value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })} />
        <button className="bg-blue-600 text-white rounded px-4 py-1" type="submit">계정 추가</button>
      </form>
      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      <div className="space-y-2 mt-4">
        {accounts.map((a) => (
          <div key={a.uid} className={`flex items-center justify-between border rounded-lg p-3 bg-white ${a.active === false ? 'opacity-50' : ''}`}>
            <div>
              <div className="font-medium">{a.name} <span className="text-sm text-gray-500">{a.id} · {a.role}</span></div>
            </div>
            <button
              className="text-sm text-gray-500 border rounded px-2 py-1"
              onClick={() => setAccountActive(a.uid, a.active === false)}
            >
              {a.active === false ? '활성화' : '비활성화'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
