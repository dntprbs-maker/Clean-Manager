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
    <div className="bg-[#F1F5F9] min-h-full">
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">계정 관리</h1>
        <p className="text-sm text-slate-500">매니저 및 최고관리자 계정을 관리합니다.</p>
      </div>

      <div className="mx-4 bg-white rounded-[22px] p-5 shadow-[0_4px_15px_rgba(0,0,0,0.05)] mb-6">
        <div className="font-semibold text-slate-700 mb-4">새 계정 추가</div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1.5">역할</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border border-slate-200 bg-white py-2.5 px-4 text-sm rounded-[14px] focus:outline-none focus:border-[#2563EB]">
              <option value="매니저">매니저</option>
              <option value="최고관리자">최고관리자(대표)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1.5">이름</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="이름을 입력하세요"
              className="w-full border border-slate-200 py-2.5 px-4 text-sm rounded-[14px] focus:outline-none focus:border-[#2563EB]" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1.5">아이디</label>
            <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="아이디를 입력하세요"
              className="w-full border border-slate-200 py-2.5 px-4 text-sm rounded-[14px] focus:outline-none focus:border-[#2563EB]" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1.5">비밀번호</label>
            <input type="password" value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })}
              placeholder="비밀번호를 입력하세요"
              className="w-full border border-slate-200 py-2.5 px-4 text-sm rounded-[14px] focus:outline-none focus:border-[#2563EB]" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button type="submit"
            className="mt-2 w-full bg-[#2563EB] hover:bg-[#1d4ed8] active:bg-[#1e40af] transition-colors text-white font-semibold py-[13px] rounded-[14px] text-sm">
            계정 추가
          </button>
        </form>
      </div>

      <div className="px-4 pb-8">
        <div className="flex items-center justify-between px-1 mb-2">
          <div className="text-sm font-semibold text-slate-600">계정 목록</div>
          <div className="text-xs text-slate-400">총 {accounts.length}명</div>
        </div>

        <div className="bg-white rounded-[22px] shadow-sm border border-slate-100 overflow-hidden">
          {accounts.map((a, i) => (
            <div key={a.uid} className={`flex items-center justify-between px-4 py-[14px] ${i !== accounts.length - 1 ? 'border-b border-slate-100' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[15px] text-slate-700">{a.name}</span>
                  <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded bg-slate-100 text-slate-400">{a.role}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{a.id}</div>
              </div>
              <button
                onClick={() => setAccountActive(a.uid, a.active === false)}
                className={`text-xs font-medium px-4 py-[6px] rounded-[10px] transition-all ${
                  a.active === false ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-[#2563EB] text-white'
                }`}
              >
                {a.active === false ? '활성화' : '비활성화'}
              </button>
            </div>
          ))}
          {accounts.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">등록된 계정이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
