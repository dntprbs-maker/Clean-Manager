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
import Header from './components/Header';
import Modal from './components/Modal';
import LoginScreen from './components/LoginScreen';
import SetupScreen from './components/SetupScreen';
import { loadStoredUser, clearStoredUser, hasAnyAccount } from './lib/auth';
import { canApproveAsAdmin, isWorker } from './lib/membership';
import { todayDate, formatDateLong } from './lib/format';

// 용역자 계정은 회사 전체 데이터(대시보드/전체 근무기록/정산/계정관리)에 접근하면 안 되고
// 본인 출퇴근 체크 + 본인 기록만 보는 전용 화면만 써야 해서, 매니저/대표용 탭과 완전히 분리한다.
const STAFF_TABS = [
  { key: 'dashboard', label: '대시보드', Component: DashboardTab },
  { key: 'workers', label: '직원 관리', Component: WorkersTab },
  { key: 'sites', label: '현장 관리', Component: SitesTab },
  { key: 'logs', label: '근무기록', Component: WorkLogsTab },
  { key: 'settlements', label: '정산', Component: SettlementsTab },
  { key: 'accounts', label: '계정 관리', Component: AccountsTab, adminOnly: true },
];

// 출퇴근만 실제 화면 전환 탭이고, 근무내역/정산내역은 팝업으로 띄운다.
const WORKER_TABS = [
  { key: 'clock', label: '출퇴근', Component: ClockScreen },
];
const WORKER_MODALS = [
  { key: 'workHistory', label: '내 근무내역', Component: MyWorkHistoryTab },
  { key: 'settlementHistory', label: '정산내역', Component: MySettlementHistoryTab },
];

function App() {
  const [user, setUser] = useState(loadStoredUser);
  const [tab, setTab] = useState(null);
  const [openModal, setOpenModal] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(null); // null=확인중

  useEffect(() => {
    if (user) return;
    hasAnyAccount().then((exists) => setNeedsSetup(!exists));
  }, [user]);

  // 항상 스마트폰 화면 비율로 고정 — PC에서 열어도 가운데 좁은 폭으로만 보이게.
  const frame = (children) => (
    <div className="min-h-screen bg-gray-200 flex justify-center">
      <div className="relative w-full max-w-[420px] min-h-screen bg-gray-50 shadow-xl">{children}</div>
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
  const allTabs = worker ? WORKER_TABS : STAFF_TABS;
  const visibleTabs = allTabs.filter((t) => !t.adminOnly || canApproveAsAdmin(user));
  const activeKey = tab || visibleTabs[0].key;
  const Active = (visibleTabs.find((t) => t.key === activeKey) || visibleTabs[0]).Component;

  const menuItems = [
    ...visibleTabs.map((t) => ({ key: t.key, label: t.label, onClick: () => setTab(t.key) })),
    ...(worker ? WORKER_MODALS.map((m) => ({ key: m.key, label: m.label, onClick: () => setOpenModal(m.key) })) : []),
  ];
  const activeModal = WORKER_MODALS.find((m) => m.key === openModal);

  return frame(
    <>
      <Header user={user} items={menuItems} activeKey={activeKey} onLogout={handleLogout} />
      <div className="text-center text-base font-medium text-gray-700 py-2 border-b bg-white">{formatDateLong(todayDate())}</div>
      <Active currentUser={user} />
      {activeModal && (
        <Modal title={activeModal.label} onClose={() => setOpenModal(null)}>
          <activeModal.Component currentUser={user} />
        </Modal>
      )}
    </>
  );
}

export default App;
