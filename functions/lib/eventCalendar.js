// calId is the canonical calendar identity. For full form saves, detect which
// assignment field actually changed before resolving its companion field.
export function syncEventCalendar(patch, calendars, previous = {}) {
  const result = { ...patch };
  const has = key => Object.prototype.hasOwnProperty.call(patch, key);
  const calChanged = has('calId') && patch.calId !== previous.calId;
  const teamChanged = has('team') && patch.team !== previous.team;
  const byId = id => calendars.find(c => c.id === id);
  if (calChanged || (has('calId') && !teamChanged)) {
    const cal = byId(patch.calId);
    if (cal) result.team = cal.label || cal.name || '';
    else if (!patch.calId || patch.calId === 'unassigned') result.team = '';
    else if (patch.calId === previous.calId) return result;
    else throw new Error('선택한 달력을 찾을 수 없습니다. 다시 선택해 주세요.');
  } else if (has('team')) {
    if (!patch.team) return { ...result, calId: '', team: '' };
    const matches = calendars.filter(c => c.label === patch.team || c.name === patch.team);
    if (matches.length !== 1) throw new Error('팀의 달력을 정확히 찾을 수 없습니다. 달력을 선택해 주세요.');
    result.calId = matches[0].id;
    result.team = matches[0].label || matches[0].name || '';

  }
  return result;
}
