import { Home, ClipboardList, Wallet, LogOut } from 'lucide-react';

const TABS = [
  { key: 'home', label: '홈', Icon: Home },
  { key: 'history', label: '내 작업내역', Icon: ClipboardList },
  { key: 'settlement', label: '정산내역', Icon: Wallet },
  { key: 'logout', label: '로그아웃', Icon: LogOut },
];

export default function BottomNav({ active, onChange }) {
  return (
    <div className="shrink-0 px-2 bg-[#EBF0F9]">
      <div className="h-16 bg-white mx-0.5 rounded-t-3xl flex items-center justify-around shadow-[0_-1px_4px_rgba(0,0,0,0.04)]">
        {TABS.map(({ key, label, Icon }) => {
          const isActive = key !== 'logout' && active === key;
          const color = key === 'logout' ? '#EF4444' : isActive ? '#2563EB' : '#64748B';
          return (
            <button key={key} onClick={() => onChange(key)} className="flex flex-col items-center gap-0.5">
              <Icon className="w-6 h-6" strokeWidth={2.25} color={color} fill={isActive && key === 'home' ? color : 'none'} />
              <span className={`text-[10px] ${isActive ? 'font-extrabold' : 'font-medium'}`} style={{ color }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
