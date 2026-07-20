import { useEffect, useState } from 'react';
import { subscribeSites, subscribeWorkers, updateSite, deleteSite } from '../lib/db';
import SiteFormModal from './SiteFormModal';

export default function SitesTab() {
  const [sites, setSites] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSite, setEditingSite] = useState(null);

  useEffect(() => subscribeSites(setSites), []);
  useEffect(() => subscribeWorkers(setWorkers), []);

  const workerName = (id) => workers.find((w) => w.id === id)?.name || '(삭제된 직원)';

  const openCreate = () => { setEditingSite(null); setFormOpen(true); };
  const openEdit = (s) => { setEditingSite(s); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingSite(null); };

  const handleDelete = (s) => {
    if (confirm(`"${s.name}" 현장을 삭제할까요? 되돌릴 수 없습니다.`)) deleteSite(s.id);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-1">현장 관리</h2>
      <p className="text-xs text-gray-400 mb-3">현장을 등록하고 그 현장에서 일할 직원을 배치하세요.</p>

      <button onClick={openCreate} className="mb-4 bg-gray-800 text-white rounded px-4 py-2 text-sm">
        현장 추가
      </button>

      <div className="space-y-2">
        {sites.map((s) => (
          <div key={s.id} className={`border rounded-lg p-3 bg-white ${!s.active ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.name}</div>
                {s.address && <div className="text-sm text-gray-500">{s.address}</div>}
                {s.note && <div className="text-xs text-gray-400">{s.note}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="text-sm text-gray-500 border rounded px-2 py-1" onClick={() => openEdit(s)}>수정</button>
                <button
                  className="text-sm text-gray-500 border rounded px-2 py-1"
                  onClick={() => updateSite(s.id, { active: !s.active })}
                >
                  {s.active ? '비활성화' : '활성화'}
                </button>
                <button className="text-sm text-red-500 border rounded px-2 py-1" onClick={() => handleDelete(s)}>삭제</button>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              배치 인원: {s.workerIds?.length ? s.workerIds.map(workerName).join(', ') : '없음'}
            </div>
          </div>
        ))}
        {sites.length === 0 && <div className="text-gray-400 text-sm">등록된 현장이 없습니다.</div>}
      </div>

      {formOpen && <SiteFormModal site={editingSite} onClose={closeForm} />}
    </div>
  );
}
