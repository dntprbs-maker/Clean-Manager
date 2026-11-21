import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

export default function CalendarAccessEditor(props) {
  const [message, setMessage] = useState('');
  return <CalendarAccessForm key={`${props.calendar.id}:${props.calendar.viewAccess?.version || 0}`}
    {...props} message={message} setMessage={setMessage}/>;
}

function CalendarAccessForm({ calendar, teams, users, message, setMessage }) {
  const [mode, setMode] = useState(calendar.viewAccess?.mode || 'legacy');
  const [selectedTeams, setTeams] = useState(calendar.viewAccess?.teams || []);
  const [people, setPeople] = useState(calendar.viewAccess?.people || []);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const access = calendar.viewAccess;
  const toggle = (setter, value) => setter(previous => previous.includes(value)
    ? previous.filter(item => item !== value) : [...previous, value]);
  const save = async event => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      await httpsCallable(functions, 'appCalendarAccess')({ calendarId: calendar.id, mode,
        teams: selectedTeams, people, expectedVersion: access?.version || 0 });
      setMessage('열람 대상을 저장했습니다.');
    } catch (error) { setMessage(error.message || '저장하지 못했습니다. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="space-y-4 py-4" aria-label={`${calendar.label || calendar.name} 열람 대상`}>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="font-semibold">이 캘린더를 볼 수 있는 대상</legend>
      <label className="flex gap-2 text-sm"><input type="radio" name={`access-${calendar.id}`} checked={mode === 'legacy'} onChange={() => setMode('legacy')}/>기존 팀 기준 유지</label>
      <label className="flex gap-2 text-sm"><input type="radio" name={`access-${calendar.id}`} checked={mode === 'selected'} onChange={() => setMode('selected')}/>팀과 사람 직접 선택</label>
      {mode === 'selected' && <>
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">선택한 팀의 소속 직원 또는 선택한 사람에게 열람을 허용합니다. 회사 관리자는 항상 볼 수 있고, 개인 캘린더 주인도 계속 볼 수 있습니다. 수정 권한은 기존 역할을 따릅니다.</p>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">팀 선택</legend>
          {teams.filter(team => team !== '사장').map(team => <label key={team} className="flex gap-2 text-sm"><input type="checkbox" checked={selectedTeams.includes(team)} onChange={() => toggle(setTeams, team)}/>{team}</label>)}
          {!teams.filter(team => team !== '사장').length && <p className="text-sm text-gray-500">등록된 팀이 없습니다.</p>}
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">사람 선택</legend>
          <input aria-label="열람 대상 이름 검색" placeholder="이름 검색" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded border p-2 text-sm"/>
          <div className="max-h-56 space-y-2 overflow-y-auto">{users.filter(user => user.status !== 'deleted' && (user.name || '').includes(search)).map(user => <label key={user.id} className="flex gap-2 text-sm"><input type="checkbox" checked={people.includes(user.id)} onChange={() => toggle(setPeople, user.id)}/>{user.name || user.id}{user.phone ? ` (${user.phone.slice(-4)})` : ''}</label>)}</div>
          {!users.length && <p className="text-sm text-gray-500">직원 등록 후 선택할 수 있습니다.</p>}
        </fieldset>
        <p className="text-xs text-gray-600">{selectedTeams.length}개 팀 · {people.length}명 선택. 아무도 선택하지 않으면 회사 관리자와 개인 캘린더 주인만 볼 수 있습니다. 제외된 사람은 다음 온라인 동기화부터 열람할 수 없습니다. 일정은 삭제되지 않습니다.</p>
        <p className="text-xs text-gray-600">직접 선택을 사용하면 기존 외부 캘린더 구독 링크와 별도 초대도 이 열람 제한을 우회할 수 없습니다. 로그인 없는 구독 링크는 사용할 수 없습니다.</p>
      </>}
    </fieldset>
    <button disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? '저장 중…' : '열람 대상 저장'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}
