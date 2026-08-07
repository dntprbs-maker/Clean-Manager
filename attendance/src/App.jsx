import { useEffect, useState } from 'react';
import DashboardTab from './components/DashboardTab';
import WorkersTab from './components/WorkersTab';
import SitesTab from './components/SitesTab';
import WorkLogsTab from './components/WorkLogsTab';
import SettlementsTab from './components/SettlementsTab';
import AccountsTab from './components/AccountsTab';
import ClockScreen from './components/ClockScreen';
import MyWorkHistoryTab from './components/MyWorkHistoryTab';
import MySettlementHistoryTab from './components/MySettlementHistoryTab';
import BottomNav from './components/BottomNav';
import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import SetupScreen from './components/SetupScreen';
import {
  loadStoredUser, clearStoredUser, hasAnyAccount, storeUser,
  devLoginWorkerByPhone, devLoginAccountById,
} from './lib/auth';
import { canApproveAsAdmin, isWorker } from './lib/membership';
import { todayDate, formatDateLong } from './lib/format';
import { isDevMode, DEV_TEST_WORKER_PHONE, DEV_ADMIN_ACCOUNT_ID } from './lib/devMode';

const STAFF_TABS = [
  { key: 'dashboard', label: '대시보드', Component: DashboardTab },
  { key: 'workers', label: '용역자 관리', Component: WorkersTab },
  { key: 'sites', label: '현장 관리', Component: SitesTab },
  { key: 'logs', label: '청소기록', Component: WorkLogsTab },
  { key: 'settlements', label: '정산', Component: SettlementsTab },
  { key: 'accounts', label: '계정 관리', Component: AccountsTab, adminOnly: true },
];

// 용역자 하단 네비게이션 — 홈(출퇴근)/내기록/정산내역. 로그아웃은 페이지가 아니라 탭을 누르면 즉시 실행되는 액션.
const WORKER_TABS = [
  { key: 'home', Component: ClockScreen },
  { key: 'history', Component: MyWorkHistoryTab },
  { key: 'settlement', Component: MySettlementHistoryTab },
];

// -------------------------------------------------
// DEV LOGIN
// UI 테스트용 기능
// 운영모드에서는 반드시 비활성화
// -------------------------------------------------
// 로그인 후에도 로그아웃 없이 관리자/직원 계정을 바로 오갈 수 있는 상단 고정바.
function DevSwitchBar({ user, setUser }) {
  const [devError, setDevError] = useState('');

  const switchTo = async (loginFn) => {
    setDevError('');
    try {
      const nextUser = await loginFn();
      storeUser(nextUser);
      setUser(nextUser);
    } catch (err) {
      setDevError(err.message || '전환 실패');
    }
  };

  return (
    <div className="w-full bg-yellow-100 border-b border-yellow-400 text-yellow-800 text-xs px-3 py-1.5 flex items-center justify-between gap-2">
      <span className="font-semibold shrink-0">🟡 DEV · {user.name}({user.role})</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {devError && <span className="text-red-500">{devError}</span>}
        <button
          type="button"
          onClick={() => switchTo(() => devLoginAccountById(DEV_ADMIN_ACCOUNT_ID))}
          className="px-2 py-1 rounded bg-gray-800 text-white"
        >
          관리자로
        </button>
        <button
          type="button"
          onClick={() => switchTo(() => devLoginWorkerByPhone(DEV_TEST_WORKER_PHONE))}
          className="px-2 py-1 rounded bg-gray-800 text-white"
        >
          용역자로
        </button>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(loadStoredUser);
  const [tab, setTab] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(null); // null=확인중
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (user) return;
    hasAnyAccount().then((exists) => setNeedsSetup(!exists));
  }, [user]);

  // 항상 스마트폰 화면 비율로 고정 — PC에서 열어도 가운데 좁은 폭으로만 보이게.
  const frame = (children, bg = 'bg-gradient-to-b from-rose-100 via-orange-50 to-amber-100') => (
    <div className="min-h-screen bg-gray-200 flex justify-center">
      <div className={`relative w-full max-w-[420px] min-h-screen shadow-xl flex flex-col ${bg}`}>{children}</div>
    </div>
  );

  if (!user) {
    if (needsSetup === null) return frame(null);
    return frame(needsSetup ? <SetupScreen onLogin={setUser} /> : <LoginScreen onLogin={setUser} />);
  }

  const handleLogout = () => {
    clearStoredUser();
    setUser(null);
  };

  const worker = isWorker(user);

  if (worker) {
    const activeKey = tab || 'home';
    const Active = (WORKER_TABS.find((t) => t.key === activeKey) || WORKER_TABS[0]).Component;
    const handleNavChange = (key) => {
      if (key === 'logout') {
        setShowLogoutConfirm(true);
        return;
      }
      setTab(key);
    };
    return frame(
      <>
        {isDevMode() && <DevSwitchBar user={user} setUser={setUser} />}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Active currentUser={user} />
        </div>
        <BottomNav active={activeKey} onChange={handleNavChange} />
        {showLogoutConfirm && (
          <>
            <div className="absolute inset-0 z-40 bg-black/30" onClick={() => setShowLogoutConfirm(false)} />
            <div className="absolute inset-0 z-50 flex items-center justify-center px-8">
              <div className="w-full bg-white rounded-2xl shadow-xl p-5 text-center">
                <p className="font-semibold text-slate-800 mb-4">로그아웃 하시겠어요?</p>
                <div className="flex gap-2">
                  <button onClick={() => setShowLogoutConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-medium">
                    취소
                  </button>
                  <button onClick={() => { setShowLogoutConfirm(false); handleLogout(); }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium">
                    로그아웃
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </>,
      'bg-[#EBF0F9]'
    );
  }

  const allTabs = STAFF_TABS;
  const visibleTabs = allTabs.filter((t) => !t.adminOnly || canApproveAsAdmin(user));
  const activeKey = tab || visibleTabs[0].key;
  const Active = (visibleTabs.find((t) => t.key === activeKey) || visibleTabs[0]).Component;
  const menuItems = visibleTabs.map((t) => ({ key: t.key, label: t.label, onClick: () => setTab(t.key) }));

  return frame(
    <>
      {isDevMode() && <DevSwitchBar user={user} setUser={setUser} />}
      <Header user={user} items={menuItems} activeKey={activeKey} onLogout={handleLogout} />
      <div className="text-center text-base font-semibold py-3 text-slate-700 border-b bg-white">{formatDateLong(todayDate())}</div>
      <Active currentUser={user} />
    </>
  );
}

export default App;
