import { useEffect, useState } from 'react';
import Modal from './Modal';
import { addSite, updateSite, subscribeWorkers } from '../lib/db';

export default function SiteFormModal({ site, onClose }) {
  const isEdit = !!site;
  const [name, setName] = useState(site?.name || '');
  const [address, setAddress] = useState(site?.address || '');
  const [note, setNote] = useState(site?.note || '');
  const [workerIds, setWorkerIds] = useState(site?.workerIds || []);
  const [workers, setWorkers] = useState([]);
  const [workerSearch, setWorkerSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => subscribeWorkers(setWorkers), []);

  const toggleWorker = (id) => {
    setWorkerIds((cur) => (cur.includes(id) ? cur.filter((w) => w !== id) : [...cur, id]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('현장 이름을 입력해주세요.'); return; }
    setError('');
    const data = { name, address, note, workerIds };
    if (isEdit) await updateSite(site.id, data);
    else await addSite(data);
    onClose();
  };

  return (
    <Modal title={isEdit ? '현장 수정' : '현장 추가'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500">현장 이름</label>
          <input className="border rounded px-2 py-2 w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">주소</label>
          <input className="border rounded px-2 py-2 w-full" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">메모</label>
          <textarea className="border rounded px-2 py-2 w-full" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">배치할 직원</label>
          <input
            className="border rounded px-2 py-2 w-full mb-1 text-sm"
            placeholder="직원 검색"
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
          />
          <div className="border rounded divide-y max-h-52 overflow-y-auto">
            {workers.filter((w) => w.name.includes(workerSearch.trim())).map((w) => (
              <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <input type="checkbox" checked={workerIds.includes(w.id)} onChange={() => toggleWorker(w.id)} />
                {w.name}
              </label>
            ))}
            {workers.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">등록된 직원이 없습니다.</div>}
            {workers.length > 0 && workers.filter((w) => w.name.includes(workerSearch.trim())).length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">검색 결과가 없습니다.</div>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" className="w-full bg-blue-600 text-white rounded py-2">저장</button>
      </form>
    </Modal>
  );
}
