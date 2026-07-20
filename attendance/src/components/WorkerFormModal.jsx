import { useState } from 'react';
import Modal from './Modal';
import { addWorker, updateWorker, payInfoOf } from '../lib/db';
import { liveFmtPhone } from '../lib/phone';

export default function WorkerFormModal({ worker, onClose }) {
  const isEdit = !!worker;
  const payInfo = worker ? payInfoOf(worker) : { type: 'hourly', rate: '' };
  const [name, setName] = useState(worker?.name || '');
  const [phone, setPhone] = useState(liveFmtPhone(worker?.phone || ''));
  const [payType, setPayType] = useState(payInfo.type);
  const [payRate, setPayRate] = useState(payInfo.rate || '');
  const [note, setNote] = useState(worker?.note || '');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    setError('');
    const data = { name, phone, payType, payRate, note };
    if (isEdit) await updateWorker(worker.id, { ...data, phone: phone.replace(/\D/g, ''), payRate: Number(payRate) || 0 });
    else await addWorker(data);
    onClose();
  };

  return (
    <Modal title={isEdit ? '직원 수정' : '직원 추가'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500">이름</label>
          <input className="border rounded px-2 py-2 w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">전화번호(로그인 아이디)</label>
          <input className="border rounded px-2 py-2 w-full" value={phone} onChange={(e) => setPhone(liveFmtPhone(e.target.value))} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-500">급여 유형</label>
            <select className="border rounded px-2 py-2 w-full" value={payType} onChange={(e) => setPayType(e.target.value)}>
              <option value="hourly">시급</option>
              <option value="daily">일급</option>
              <option value="weekly">주급</option>
              <option value="monthly">월급</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">금액</label>
            <input type="number" className="border rounded px-2 py-2 w-full" value={payRate} onChange={(e) => setPayRate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500">메모</label>
          <textarea className="border rounded px-2 py-2 w-full" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" className="w-full bg-blue-600 text-white rounded py-2">저장</button>
      </form>
    </Modal>
  );
}
