import { useState } from 'react';
import { fmtPhone } from '../lib/phone';

export default function Header({ user, items, activeKey, onLogout, theme = 'light' }) {
  const [open, setOpen] = useState(false);
  const dark = theme === 'blue';

  return (
    <div className={`sticky top-0 z-10 h-16 ${dark ? 'bg-transparent' : 'bg-white border-b'}`}>
      <div className="h-16 flex items-center gap-3 px-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="메뉴"
          className={`w-10 h-10 flex flex-col items-center justify-center gap-1 shrink-0 -ml-1 rounded-lg ${dark ? 'active:bg-black/5' : 'active:bg-slate-100'}`}
        >
          <span className={`block w-[17px] h-[2.5px] rounded-full ${dark ? 'bg-[#0c2a4d]' : 'bg-slate-700'}`} />
          <span className={`block w-[17px] h-[2.5px] rounded-full ${dark ? 'bg-[#0c2a4d]' : 'bg-slate-700'}`} />
          <span className={`block w-[17px] h-[2.5px] rounded-full ${dark ? 'bg-[#0c2a4d]' : 'bg-slate-700'}`} />
        </button>
        <div>
          <span className={dark ? 'text-[#0c2a4d] text-[15px] font-semibold tracking-[-0.3px]' : 'font-bold text-slate-800'}>{user.name}</span>{' '}
          <span className={dark ? 'text-[#0c2a4d] text-[15px] font-semibold tracking-[-0.3px]' : 'text-xs font-normal text-slate-400'}>({fmtPhone(user.id)})</span>
        </div>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setOpen(false)} />
          <div className="absolute left-2 top-full mt-1 z-40 w-52 bg-white rounded-2xl shadow-lg border overflow-hidden">
            {items.map((item) => (
              <button
                key={item.key}
                onClick={() => { item.onClick(); setOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm border-b last:border-b-0 ${activeKey === item.key ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-600'}`}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={onLogout}
              className="w-full text-left px-4 py-3 text-sm text-red-500 border-t"
            >
              로그아웃
            </button>
          </div>
        </>
      )}
    </div>
  );
}
