import { useEffect, useState } from 'react';
import {
  checkLoginId, loginWorker, setWorkerPassword, login, storeUser,
  devLoginWorkerByPhone, devLoginAccountById,
} from '../lib/auth';
import { liveFmtPhone } from '../lib/phone';
import { isDevMode, DEV_TEST_WORKER_PHONE, DEV_ADMIN_ACCOUNT_ID } from '../lib/devMode';

const isPhone = (v) => /^0\d{9,10}$/.test(v.trim().replace(/-/g, ''));

export default function LoginScreen({ onLogin }) {
  const devMode = isDevMode();
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

    // ---------------------------------------------
    // DEV LOGIN — UI 테스트용 기능, 운영모드에서는 반드시 비활성화
    // 개발모드에서는 비밀번호 검사 없이 전화번호만으로 즉시 로그인 처리.
    // 운영모드 로직(checkLoginId → setup/login 분기)은 아래 else에서 그대로 유지.
    // ---------------------------------------------
    if (devMode) {
      devLoginWorkerByPhone(id).then((user) => {
        if (cancelled) return;
        storeUser(user);
        onLogin(user);
      }).catch((err) => {
        if (cancelled) return;
        setError(err.message || '등록되지 않은 용역자입니다.');
      }).finally(() => { if (!cancelled) setChecking(false); });
      return () => { cancelled = true; };
    }

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
  }, [id, mode, devMode]);

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

  // ---------------------------------------------
  // DEV LOGIN — UI 테스트용 기능, 운영모드에서는 반드시 비활성화
  // 우측 상단 바로가기 버튼: 관리자/테스트 직원 계정으로 즉시 로그인.
  // ---------------------------------------------
  const handleDevAdminQuick = async () => {
    setError('');
    setLoading(true);
    try {
      const user = await devLoginAccountById(DEV_ADMIN_ACCOUNT_ID);
      storeUser(user);
      onLogin(user);
    } catch (err) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDevWorkerQuick = async () => {
    setError('');
    setLoading(true);
    try {
      const user = await devLoginWorkerByPhone(DEV_TEST_WORKER_PHONE);
      storeUser(user);
      onLogin(user);
    } catch (err) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-b from-sky-100 via-blue-50 to-indigo-100 px-6 pt-[24px] pb-[19px] flex flex-col items-center">
      {/* 장식용 반짝임 */}
      <span className="absolute top-5 left-8 text-blue-300 text-base select-none">✦</span>
      <span className="absolute top-24 right-8 text-blue-300 text-xs select-none">✦</span>
      <span className="absolute bottom-48 left-6 text-blue-200 text-sm select-none">✦</span>
      <span className="absolute bottom-[136px] right-10 text-blue-200 text-xs select-none">✦</span>

      {devMode && (
        <>
          {/* DEV LOGIN — UI 테스트용 기능, 운영모드에서는 반드시 비활성화 */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-yellow-100 border border-yellow-400 text-yellow-800 text-xs font-semibold px-2 py-1 rounded-full">
            🟡 DEV MODE
          </div>
          <div className="absolute top-3 right-3 z-20 flex gap-2">
            <button
              type="button"
              onClick={handleDevAdminQuick}
              className="text-xs bg-gray-800 text-white rounded px-2 py-1"
            >
              관리자 바로가기
            </button>
            <button
              type="button"
              onClick={handleDevWorkerQuick}
              className="text-xs bg-gray-800 text-white rounded px-2 py-1"
            >
              용역자 바로가기
            </button>
          </div>
        </>
      )}

      {/* 로고 */}
      <div className="relative z-10 w-full mb-[13px] flex justify-center">
        <img src="/crindream-logo.png" alt="(주)크린드림 청소 대행사 인증업체" className="w-[85%] h-auto" />
      </div>

      <div className="relative z-10 flex items-center gap-2 mb-[15px] text-blue-300">
        <span className="w-8 h-px bg-blue-200" />
        <span className="text-xs">✦</span>
        <span className="w-8 h-px bg-blue-200" />
      </div>

      <h2 className="relative z-10 text-xl font-bold text-slate-800 text-center mb-[5px]">
        정기청소 <span className="text-blue-600">현장상황기록부</span>
      </h2>
      <p className="relative z-10 text-xs text-slate-500 text-center leading-relaxed mb-[18px]">
        현장 작업 시작부터 완료까지<br />모든 과정을 쉽고 정확하게 기록하세요.
      </p>

      <form onSubmit={handleSubmit} className="relative z-10 w-full bg-white rounded-3xl shadow-xl px-6 py-[15px] space-y-[11px]">
        <div className="flex flex-col items-center text-center mb-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <line x1="11" y1="18" x2="13" y2="18" />
              </svg>
            </span>
            <h3 className="font-bold text-slate-800">전화번호로 로그인</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">등록된 전화번호로 간편하게 로그인하세요.</p>
        </div>

        <div className="flex items-center gap-2 border border-slate-200 rounded-2xl px-4 py-[7px] focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-blue-400">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-400 shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
          </svg>
          <input
            className="flex-1 outline-none text-sm placeholder:text-slate-400 bg-transparent"
            placeholder="전화번호 (숫자만 입력)"
            value={id}
            onChange={handleIdChange}
            onBlur={handleIdBlur}
          />
        </div>
        {checking && <p className="text-xs text-gray-400 text-center">확인 중...</p>}

        {mode === 'setup' && (
          <>
            <p className="text-sm text-blue-600 text-center">{setupInfo.name}님, 첫 로그인이시네요. 비밀번호를 설정해주세요.</p>
            <input
              type="password"
              className="w-full border border-slate-200 rounded-2xl px-4 py-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
              placeholder="새 비밀번호 (4자 이상)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <input
              type="password"
              className="w-full border border-slate-200 rounded-2xl px-4 py-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
              placeholder="비밀번호 확인"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </>
        )}

        {mode === 'login' && (
          <input
            type="password"
            className="w-full border border-slate-200 rounded-2xl px-4 py-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            placeholder="비밀번호"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        )}

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading || mode === 'id'}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl py-3 transition disabled:opacity-40"
        >
          {loading ? '확인 중...' : mode === 'setup' ? '비밀번호 설정하고 시작하기' : '로그인'}
        </button>

        <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400 pt-1">
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          전화번호는 (주)크린드림에 등록된 번호를 입력해주세요.
        </p>
      </form>

      <div className="relative z-10 w-full bg-blue-50/70 border border-blue-100 rounded-2xl px-4 py-[10px] mt-[10px] flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-blue-500 shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0118 0v6" />
            <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold text-blue-900">처음 이용하시나요?</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">로그인이 되지 않거나 문의사항이 있으시면<br />담당자에게 연락하여 전화번호 등록을 요청해주세요.</p>
        </div>
      </div>

      <p className="relative z-10 text-[11px] text-slate-400 mt-[15px]">© 2026 (주)크린드림. All rights reserved.</p>
    </div>
  );
}
