import { useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { subscribeSites, subscribeWorkers, updateSite, deleteSite } from '../lib/db';
import SiteFormModal from './SiteFormModal';

export default function SitesTab() {
  const [sites, setSites] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSite, setEditingSite] = useState(null);

  useEffect(() => subscribeSites(setSites), []);
  useEffect(() => subscribeWorkers(setWorkers), []);

  const workerName = (id) => workers.find((w) => w.id === id)?.name || '(삭제된 용역자)';

  const openCreate = () => { setEditingSite(null); setFormOpen(true); };
  const openEdit = (s) => { setEditingSite(s); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingSite(null); };

  const handleDelete = (s) => {
    if (confirm(`"${s.name}" 현장을 삭제할까요? 되돌릴 수 없습니다.`)) deleteSite(s.id);
  };

  return (
    <div className="bg-[#E6F0FF] min-h-full py-4 px-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">현장 관리</h1>
        <p className="mt-1 text-sm text-slate-600">등록된 현장 정보를 확인하고 관리하세요.</p>
      </div>

      <div className="mb-5">
        <button onClick={openCreate}
          className="w-full flex items-center justify-center gap-2 bg-[#2563EB] hover:bg-[#1E55C8] transition-colors text-white py-[13px] rounded-full text-sm font-semibold shadow-md">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          <span>현장 추가</span>
        </button>
      </div>

      <div className="space-y-3">
        {sites.map((s) => (
          <div key={s.id} className={`bg-white rounded-[22px] shadow-[0_4px_15px_rgba(37,99,235,0.08)] p-4 ${!s.active ? 'opacity-50' : ''}`}>
            <div className="flex gap-3">
              <span className="w-10 h-10 bg-[#2563EB] rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
                <MapPin className="w-5 h-5 text-white" fill="white" strokeWidth={0} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-base text-slate-900">{s.name}</h3>
                    {s.address && <p className="text-sm text-slate-600 mt-0.5">{s.address}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 ml-2 shrink-0">
                    <button onClick={() => openEdit(s)}
                      className="px-3 py-1 bg-[#2563EB]/10 hover:bg-[#2563EB]/20 text-[#2563EB] text-xs font-medium rounded-full transition-colors">
                      수정
                    </button>
                    <button onClick={() => updateSite(s.id, { active: !s.active })}
                      className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-600 text-xs font-medium rounded-full transition-colors">
                      {s.active ? '비활성화' : '활성화'}
                    </button>
                    <button onClick={() => handleDelete(s)}
                      className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-500 text-xs font-medium rounded-full transition-colors">
                      삭제
                    </button>
                  </div>
                </div>

                <div className="mt-3 bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-slate-500">배치 인원</span>
                    <span className="text-xs font-semibold text-slate-700">
                      {s.workerIds?.length ? s.workerIds.map(workerName).join(', ') : '없음'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
        {sites.length === 0 && <div className="text-gray-400 text-sm text-center py-8">등록된 현장이 없습니다.</div>}
      </div>

      {formOpen && <SiteFormModal site={editingSite} onClose={closeForm} />}
    </div>
  );
}
