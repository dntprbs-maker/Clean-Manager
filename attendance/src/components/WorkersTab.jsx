import { useEffect, useState } from 'react';
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
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-1">직원 관리</h2>
      <p className="text-xs text-gray-400 mb-3">여기 등록한 전화번호가 곧 로그인 아이디입니다. 직원이 처음 로그인할 때 본인이 비밀번호를 설정해요.</p>

      <button onClick={openCreate} className="mb-4 bg-gray-800 text-white rounded px-4 py-2 text-sm">
        직원 추가
      </button>

      <div className="space-y-2">
        {workers.map((w) => {
          const { type, rate } = payInfoOf(w);
          return (
            <div key={w.id} className={`flex items-center justify-between border rounded-lg p-3 bg-white ${!w.active ? 'opacity-50' : ''}`}>
              <div>
                <div className="font-medium">{w.name} <span className="text-sm text-gray-500">{fmtPhone(w.phone)}</span></div>
                <div className="text-sm text-gray-500">{PAY_TYPE_LABEL[type]} {formatWon(rate)} {w.note && `· ${w.note}`}</div>
                <div className="text-xs text-gray-400">{w.pw ? '로그인 설정됨' : '아직 로그인 안 함(첫 로그인 대기)'}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="text-sm text-gray-500 border rounded px-2 py-1" onClick={() => openEdit(w)}>수정</button>
                <button
                  className="text-sm text-gray-500 border rounded px-2 py-1"
                  onClick={() => updateWorker(w.id, { active: !w.active })}
                >
                  {w.active ? '비활성화' : '활성화'}
                </button>
                <button className="text-sm text-red-500 border rounded px-2 py-1" onClick={() => handleDelete(w)}>삭제</button>
              </div>
            </div>
          );
        })}
        {workers.length === 0 && <div className="text-gray-400 text-sm">등록된 직원이 없습니다.</div>}
      </div>

      {formOpen && <WorkerFormModal worker={editingWorker} onClose={closeForm} />}
    </div>
  );
}
