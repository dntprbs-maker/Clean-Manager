import { useEffect, useState } from 'react';
import { User, Plus } from 'lucide-react';
import { subscribeWorkers, updateWorker, deleteWorker, payInfoOf } from '../lib/db';
import { formatWon, PAY_TYPE_LABEL } from '../lib/format';
import { fmtPhone } from '../lib/phone';
import WorkerFormModal from './WorkerFormModal';

export default function WorkersTab() {
  const [workers, setWorkers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);

  useEffect(() => subscribeWorkers(setWorkers), []);

  const openCreate = () => { setEditingWorker(null); setFormOpen(true); };
  const openEdit = (w) => { setEditingWorker(w); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingWorker(null); };

  const handleDelete = (w) => {
    if (confirm(`${w.name}님을 삭제할까요? 되돌릴 수 없습니다.`)) deleteWorker(w.id);
  };

  return (
    <div className="bg-[#E8F0FA] min-h-full pb-6">
      <div className="px-5 pt-6 pb-2">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">용역자 관리</h1>
            <p className="text-sm text-slate-500 mt-0.5">용역자 등록 및 관리</p>
          </div>
          <div className="px-3 py-1.5 bg-white rounded-full text-xs flex items-center shadow-sm shrink-0">
            <span className="w-2 h-2 bg-emerald-500 rounded-full mr-1.5" />
            <span className="text-emerald-600 text-xs font-medium">총 {workers.length}명</span>
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          등록된 용역자의 정보를 확인하고, 로그인 설정을 관리할 수 있습니다.
        </p>

        <button onClick={openCreate}
          className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors text-white font-semibold py-[13px] px-6 rounded-[14px] text-[15px] shadow-sm flex items-center justify-center gap-x-2">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          <span>용역자 추가</span>
        </button>
      </div>

      <div className="mx-4">
        <div className="bg-white rounded-[22px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] px-1 py-1">
          {workers.map((w, i) => {
            const { type, rate } = payInfoOf(w);
            return (
              <div key={w.id} className={`px-5 py-[18px] flex items-start gap-3 ${i < workers.length - 1 ? 'border-b border-[#F1F5F9]' : ''} ${!w.active ? 'opacity-50' : ''}`}>
                <span className="w-9 h-9 bg-[#2563EB] rounded-full shrink-0 flex items-center justify-center">
                  <User className="w-4.5 h-4.5 text-white" fill="currentColor" strokeWidth={0} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[15.5px] text-slate-800">{w.name}</div>
                  <div className="text-slate-500 text-[13.5px] mt-px">{fmtPhone(w.phone)}</div>
                  <div className="mt-2">
                    <div className="text-sm text-slate-600">{PAY_TYPE_LABEL[type]} {formatWon(rate)} {w.note && `· ${w.note}`}</div>
                    <div className={`mt-1 text-xs font-medium ${w.pw ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {w.pw ? '로그인 설정됨' : '아직 로그인 안 함'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs mt-1 shrink-0">
                  <button onClick={() => openEdit(w)} className="text-[#2563EB] px-2 py-[1px] font-medium hover:bg-blue-50 rounded">수정</button>
                  <button onClick={() => updateWorker(w.id, { active: !w.active })} className="text-amber-600 px-2 py-[1px] font-medium hover:bg-amber-50 rounded">
                    {w.active ? '비활성화' : '활성화'}
                  </button>
                  <button onClick={() => handleDelete(w)} className="text-red-500 px-2 py-[1px] font-medium hover:bg-red-50 rounded">삭제</button>
                </div>
              </div>
            );
          })}
          {workers.length === 0 && <div className="text-gray-400 text-sm px-5 py-6">등록된 용역자가 없습니다.</div>}
        </div>
      </div>

      <div className="px-5 mt-4">
        <div className="text-[11px] text-slate-400 px-1">
          • 로그인 설정은 용역자가 앱에서 직접 진행할 수 있습니다.<br />
          • 비활성화된 용역자는 로그인할 수 없습니다.
        </div>
      </div>

      {formOpen && <WorkerFormModal worker={editingWorker} onClose={closeForm} />}
    </div>
  );
}
