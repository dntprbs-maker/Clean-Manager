// ── 캘린더(담당팀) 목록 ───────────────────────────────────────────────
// 신규 업체 가입 시 기본으로 깔리는 캘린더(=담당팀별 색상). 가입 시 Firestore에도 시드된다.
export const DEFAULT_CALS = [
  { id: "clean0", label: "관리팀",     name: "관리팀",     color: "#1a56db", checked: true, isField: false },
  { id: "clean1", label: "영업팀",     name: "영업팀",     color: "#16a34a", checked: true, isField: false },
  { id: "clean2", label: "입주청소팀", name: "입주청소팀", color: "#ea580c", checked: true, isField: true  },
];
// 정기청소 배정에서 자동 생성되는 캘린더의 고정 id — 팀 관리와 무관하게 이 기능 전용으로 씀
export const REGULAR_CAL_ID = "regular_cleaning";
// 모듈 전역에서 calById/색상 조회에 쓰는 "현재 캘린더" 미러.
// Provider가 Firestore cals 스냅샷을 받을 때마다 내용물을 교체(splice)해서 항상 최신값을 유지한다.
// (const 참조는 그대로 두고 배열 내용만 갈아끼워야 기존 calById/CALS.find 호출부가 전부 동작함)
export const CALS = [...DEFAULT_CALS];

export const calById = id => CALS.find(c=>c.id===id) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af", checked:true };
