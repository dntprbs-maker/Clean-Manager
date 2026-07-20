import { useEffect, useState } from 'react';
import { checkLoginId, loginWorker, setWorkerPassword, login, storeUser } from '../lib/auth';
import { liveFmtPhone } from '../lib/phone';

const isPhone = (v) => /^0\d{9,10}$/.test(v.trim().replace(/-/g, ''));

export default function LoginScreen({ onLogin }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mode, setMode] = useState('id'); // 'id' | 'login' | 'setup'
  const [setupInfo, setSetupInfo] = useState(null); // { workerId, name }
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);

  const resetToIdMode = () => {
    if (mode === 'id') return;
    setMode('id');
    setSetupInfo(null);
    setPw('');
    setPw2('');
    setError('');
  };

  const handleIdChange = (e) => {
    const raw = e.target.value;
    const isNumericInput = /^[0-9-]*$/.test(raw);
    setId(isNumericInput ? liveFmtPhone(raw) : raw);
    resetToIdMode();
  };

  // 전화번호는 11자리(또는 10자리)가 다 채워지면 blur 없이도 바로 자동 확인.
  useEffect(() => {
    if (mode !== 'id' || !isPhone(id)) return;
    let cancelled = false;
    setError('');
    setChecking(true);
    checkLoginId(id).then((res) => {
      if (cancelled) return;
      if (res.kind === 'worker-needs-setup') {
        setSetupInfo({ workerId: res.workerId, name: res.name });
        setMode('setup');
      } else if (res.kind === 'worker-has-pw') {
        setMode('login');
      } else {
        setError('등록되지 않은 전화번호입니다.');
      }
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [id, mode]);

  // 매니저/대표 아이디(전화번호 형태 아님)는 완성 시점을 알 수 없어 blur로 판단.
  const handleIdBlur = () => {
    if (mode !== 'id' || !id.trim() || isPhone(id)) return;
    if (id.trim().length >= 2) setMode('login'); // 존재 여부는 실제 로그인 시도 시 확인
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'setup') {
        if (pw.length < 4) throw new Error('비밀번호는 4자 이상으로 해주세요.');
        if (pw !== pw2) throw new Error('비밀번호가 일치하지 않습니다.');
        const user = await setWorkerPassword(setupInfo.workerId, pw);
        storeUser(user);
        onLogin(user);
        return;
      }
      if (mode === 'login') {
        const user = isPhone(id) ? await loginWorker(id, pw) : await login(id, pw);
        storeUser(user);
        onLogin(user);
      }
    } catch (err) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 w-full space-y-3">
        <h1 className="text-lg font-semibold text-center mb-2">정기청소 근무관리</h1>

        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="전화번호"
          value={id}
          onChange={handleIdChange}
          onBlur={handleIdBlur}
        />
        {checking && <p className="text-xs text-gray-400">확인 중...</p>}

        {mode === 'setup' && (
          <>
            <p className="text-sm text-blue-600">{setupInfo.name}님, 첫 로그인이시네요. 비밀번호를 설정해주세요.</p>
            <input
              type="password"
              className="border rounded px-3 py-2 w-full"
              placeholder="새 비밀번호 (4자 이상)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <input
              type="password"
              className="border rounded px-3 py-2 w-full"
              placeholder="비밀번호 확인"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </>
        )}

        {mode === 'login' && (
          <input
            type="password"
            className="border rounded px-3 py-2 w-full"
            placeholder="비밀번호"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading || mode === 'id'}
          className="bg-blue-600 text-white rounded px-4 py-2 w-full disabled:opacity-40"
        >
          {loading ? '확인 중...' : mode === 'setup' ? '비밀번호 설정하고 시작하기' : '로그인'}
        </button>
      </form>
    </div>
  );
}
