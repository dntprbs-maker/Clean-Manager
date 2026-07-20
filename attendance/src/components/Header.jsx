import { useState } from 'react';
import { fmtPhone } from '../lib/phone';

export default function Header({ user, items, activeKey, onLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-10 bg-white border-b">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="메뉴"
          className="w-9 h-9 flex flex-col items-center justify-center gap-1 shrink-0 -ml-1"
        >
          <span className="block w-5 h-0.5 bg-gray-700" />
          <span className="block w-5 h-0.5 bg-gray-700" />
          <span className="block w-5 h-0.5 bg-gray-700" />
        </button>
        <div className="font-semibold">
          {user.name} <span className="text-gray-400 font-normal">({fmtPhone(user.id)})</span>
        </div>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setOpen(false)} />
          <div className="absolute left-2 top-full mt-1 z-40 w-52 bg-white rounded-lg shadow-lg border overflow-hidden">
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
