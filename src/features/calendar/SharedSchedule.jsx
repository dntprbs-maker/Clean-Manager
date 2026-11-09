import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

const call = httpsCallable(functions, 'appSharedSchedule');
const request = async input => (await call(input)).data;

export function ScheduleInviteEditor({ eventId, calendarId, day, teams = [] }) {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState([]);
  const [phone, setPhone] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const perform = async (action, extra) => {
    setBusy(true);
    setMessage('');
    try {
      const target = calendarId ? { calendarId } : day ? { eventId, day } : { eventId };
      if (action) await request({ action, ...target, ...extra });
      setInvites((await request({ action: 'sent', ...target })).invites);
      if (action === 'invite') setPhone('');
    } catch (error) {
      setMessage(error.message || '일정 초대를 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const label = calendarId ? '이 캘린더 공유' : day ? '이 회차만 공유' : '이 일정 공유';
  if (!open) return <button type="button" className="mx-5 my-3 text-sm font-semibold text-blue-700"
    onClick={() => { setOpen(true); perform(); }}>{label}</button>;
  return <section className="space-y-3 border-b px-5 py-4">
    <h3 className="font-semibold">{label}</h3>
    <p className="text-sm text-gray-600">{calendarId ? '이 캘린더에 포함된 일정의 제목과 날짜, 시간을 공유합니다.' : '선택한 일정 한 건의 제목과 날짜, 시간을 공유합니다.'} 별도로 받은 권한은 유지됩니다.</p>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); perform('invite', { phone }); }}>
      <input aria-label="기존 회원 전화번호" className="min-w-0 flex-1 rounded border px-2" type="tel"
        value={phone} onChange={e => setPhone(e.target.value)} required />
      <button className="rounded bg-blue-700 px-3 py-2 text-sm text-white" disabled={busy}>초대</button>
    </form>
    {teams.length > 0 && <form className="flex gap-2" onSubmit={e => { e.preventDefault(); perform('inviteTeam', { team }); }}>
      <select aria-label="공유할 팀" className="min-w-0 flex-1 rounded border px-2" value={team} onChange={e => setTeam(e.target.value)} required>
        <option value="">팀 선택</option>
        {teams.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <button className="rounded border px-3 py-2 text-sm" disabled={busy}>팀에 공유</button>
    </form>}
    <ul>{invites.map(invite => <li key={invite.id} className="flex justify-between py-2 text-sm">
      <span>{invite.team || `번호 끝 ${invite.phoneTail}`}</span>
      <button type="button" className="text-red-700" disabled={busy} onClick={() => {
        if (window.confirm('이 회원의 일정 초대를 제거할까요? 일정 자체는 그대로 유지됩니다.')) perform('remove', { grantId: invite.id });
      }}>초대 제거</button>
    </li>)}</ul>
    {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
  </section>;
}

export function ReceivedSchedules() {
  const [state, setState] = useState({ loading: true, events: [] });
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const id = ++sequence;
      try {
        const range = from ? { from, to: new Date(Date.parse(from) + 99 * 86400000).toISOString().slice(0, 10) } : {};
        const { events } = await request({ action: 'received', ...range });
        if (active && id === sequence) setState({ loading: false, events });
      } catch {
        if (active && id === sequence) setState({ loading: false, events: [], error: true });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [from]);
  return <section className="flex-1 overflow-y-auto p-5">
    <h2 className="mb-4 text-lg font-bold">공유받은 일정</h2>
    <form className="mb-4 flex flex-wrap items-center gap-2 text-sm" onSubmit={event => {
      event.preventDefault();
      if (from !== date) { setState({ loading: true, events: [] }); setFrom(date); }
    }}>
      <label>캘린더 조회 시작일 <input type="date" className="rounded border p-1"
        value={date} onChange={event => setDate(event.target.value)}/></label>
      <button className="rounded border px-2 py-1">조회</button>
      <p className="w-full text-gray-600">선택한 날부터 100일을 표시합니다. 기본은 지난 7일부터 앞으로 92일까지입니다.</p>
    </form>
    {state.loading ? <p>불러오는 중…</p> : state.error ? <p role="alert">공유 일정을 확인할 수 없습니다.</p> :
      !state.events.length ? <p>공유받은 일정이 없습니다.</p> : <ul className="divide-y">{state.events.map(event => <li key={event.id} className="py-3">
        <p className="font-semibold">{event.title}</p>
        <p className="text-sm text-gray-600">{event.companyName}</p>
        <p className="text-sm">{event.start}{event.end && event.end !== event.start ? ` ~ ${event.end}` : ''}
          {' '}{event.allDay ? '종일' : [event.startTime, event.endTime].filter(Boolean).join(' ~ ')}</p>
      </li>)}</ul>}
  </section>;
}
