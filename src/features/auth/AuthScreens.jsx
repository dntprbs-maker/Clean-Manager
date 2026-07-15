import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { enablePush } from "../../fcm";
import { fmt } from "../../lib/dateTime";
import { onlyDigits, fmtPhone } from "../../lib/phone";
import { DEFAULT_CALS } from "../../lib/calendars";
import { INIT_TEAMS } from "../../lib/constants";
import { useC } from "../../context/AppContext";

export function LoginScreen({ onLogin }) {
  const [mode, setMode]               = useState("login");  // login | register | setPw
  const [id, setId]                   = useState("");
  const [pw, setPw]                   = useState("");
  const [pw2, setPw2]                 = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoPreview, setLogoPreview] = useState(null);
  const [showPw, setShowPw]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [pendingUser, setPendingUser] = useState(null);
  const [multiCompanies, setMultiCompanies] = useState(null); // 다중 소속 회사 선택용
  const [hasPw, setHasPw]             = useState(null); // null=미확인, true=비번있음, false=최초

  const isPhone = id => id.replace(/-/g,"").startsWith("0");
  const phoneComplete = id => isPhone(id) && id.replace(/-/g,"").length >= 10;

  // 전화번호 완성 시 Firestore에서 비밀번호 여부 확인
  useEffect(() => {
    if (!phoneComplete(id)) { setHasPw(null); return; }
    let cancelled = false;
    getDocs(query(collection(db,"staffs"), where("phone","==",onlyDigits(id))))
      .then(snap => {
        if (cancelled) return;
        if (snap.empty) { setHasPw(true); return; } // 없으면 관리자일 수 있으니 표시
        setHasPw(!!snap.docs[0].data().pw);
      })
      .catch(() => setHasPw(true));
    return () => { cancelled = true; };
  }, [id]);

  // 로그인 - 아이디/전화번호 자동 구분
  const handleLogin = async () => {
    if(!id.trim()){ setError("아이디 또는 전화번호를 입력하세요."); return; }
    setLoading(true); setError("");
    try {
      const isPhone = /^0\d{9,10}$/.test(id.trim().replace(/-/g,""));

      if(isPhone) {
        // 직원 (전화번호로 조회) — 숫자만으로 우선 조회, 못 찾으면 하이픈 포맷으로도 조회(구버전 데이터 호환)
        const phone = onlyDigits(id);
        let staffSnap = await getDocs(query(collection(db,"staffs"), where("phone","==",phone)));
        if(staffSnap.empty){
          staffSnap = await getDocs(query(collection(db,"staffs"), where("phone","==",fmtPhone(phone))));
        }
        // status:"deleted" 제외
        const activeDocs = staffSnap.docs.filter(d => d.data().status !== "deleted");
        if(activeDocs.length === 0){ setError("등록되지 않은 전화번호입니다."); setLoading(false); return; }

        // 비밀번호 확인 (첫 번째 문서 기준)
        const firstData = activeDocs[0].data();
        if(!firstData.pw) {
          const compDoc = await getDoc(doc(db,"companies",firstData.companyId));
          setPendingUser({...firstData, uid:activeDocs[0].id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져", companyLogoUrl:compDoc.data()?.logoUrl});
          setMode("setPw"); setLoading(false); return;
        }
        if(!pw.trim()){ setError("비밀번호를 입력하세요."); setLoading(false); return; }
        if(firstData.pw !== pw){ setError("비밀번호가 올바르지 않습니다."); setLoading(false); return; }

        // 다중 소속 회사 처리
        if(activeDocs.length > 1) {
          const companies = await Promise.all(activeDocs.map(async d => {
            const compDoc = await getDoc(doc(db,"companies",d.data().companyId));
            return { staffDoc: d, companyName: compDoc.exists()?compDoc.data().name:"알 수 없는 회사" };
          }));
          setMultiCompanies({ companies, pw });
          setLoading(false); return;
        }

        // 단일 소속
        const compDoc = await getDoc(doc(db,"companies",firstData.companyId));
        const user = {...firstData, uid:activeDocs[0].id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져", companyLogoUrl:compDoc.data()?.logoUrl};
        try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
        onLogin(user); return;
      } else {
        // 관리자 (아이디로 조회)
        if(!pw.trim()){ setError("비밀번호를 입력하세요."); setLoading(false); return; }
        const adminQ = query(collection(db,"admins"), where("id","==",id.trim()));
        const adminSnap = await getDocs(adminQ);
        if(adminSnap.empty){ setError("등록되지 않은 아이디입니다."); setLoading(false); return; }
        const activeAdmin = adminSnap.docs.find(d => d.data().status !== "deleted");
        if(!activeAdmin){ setError("탈퇴 또는 삭제된 계정입니다."); setLoading(false); return; }
        const adminData = activeAdmin.data();
        if(adminData.pw !== pw){ setError("비밀번호가 올바르지 않습니다."); setLoading(false); return; }
        const compDoc = await getDoc(doc(db,"companies",adminData.companyId));
        if(compDoc.exists() && compDoc.data().status === "deleted"){ setError("탈퇴 또는 삭제된 업체입니다."); setLoading(false); return; }
        const user = {...adminData, uid:activeAdmin.id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져", companyLogoUrl:compDoc.data()?.logoUrl, role:"최고관리자"};
        try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
        onLogin(user); return;
      }
    } catch(e) {
      console.error(e);
      setError("로그인 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // 첫 로그인 비밀번호 설정
  const handleSetPw = async () => {
    if(!pw||!pw2){ setError("비밀번호를 입력하세요."); return; }
    if(pw!==pw2){ setError("비밀번호가 일치하지 않습니다."); return; }
    if(pw.length<4){ setError("비밀번호는 4자 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      await updateDoc(doc(db,"staffs",pendingUser.uid), { pw });
      // companies/{companyId}/users에도 동기화
      if (pendingUser.companyId) {
        await updateDoc(doc(db,"companies",pendingUser.companyId,"users",pendingUser.uid), { pw });
      }
      const user = {...pendingUser, pw};
      try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
      setPendingUser(user);
      setMode("notifyConsent"); // 비번 설정 후 알림 동의 단계로
    } catch(e) {
      console.error(e);
      setError("비밀번호 설정 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // 알림 동의 → 권한 요청 + 토큰 등록 후 앱 진입
  const handleNotifyConsent = async () => {
    setLoading(true);
    try { await enablePush(pendingUser); } catch { /* 실패해도 진입은 허용 */ }
    onLogin(pendingUser);
    setLoading(false);
  };

  // 업체 가입
  const handleRegister = async () => {
    if(!id||!pw||!pw2){ setError("모든 항목을 입력하세요."); return; }
    if(id.trim().startsWith("0")){ setError("아이디는 0으로 시작할 수 없습니다."); return; }
    if(pw!==pw2){ setError("비밀번호가 일치하지 않습니다."); return; }
    if(pw.length<4){ setError("비밀번호는 4자 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      const adminQ = query(collection(db,"admins"), where("id","==",id.trim()));
      const adminSnap = await getDocs(adminQ);
      const activeExists = adminSnap.docs.some(d => d.data().status !== "deleted");
      if(activeExists){ setError("이미 사용 중인 아이디입니다."); setLoading(false); return; }
      const companyId = "c_" + Math.random().toString(36).slice(2,9);
      const adminId   = "a_" + Math.random().toString(36).slice(2,9);
      // 회사명은 기본값으로 설정 (나중에 회사 설정에서 변경)
      // AI 추출 등 부가 기능은 전부 기본 OFF — 요금제에 따라 슈퍼어드민에서 개별로 켜줌
      await setDoc(doc(db,"companies",companyId), {
        name:"내 회사", companyId, createdAt:new Date().toISOString(),
        aiTextExtraction: false, aiImageExtraction: false,
      });
      await setDoc(doc(db,"admins",adminId), { id:id.trim(), pw, name:id.trim(), companyId, role:"최고관리자", team:"사장", createdAt:new Date().toISOString() });
      // 기본 캘린더(담당팀 색상) 시드 — 이게 없으면 일정이 달력에 안 보임
      await Promise.all(DEFAULT_CALS.map(c => setDoc(doc(db,"companies",companyId,"cals",c.id), c)));
      // 기본 팀 목록 + 링크 카테고리 시드 (사장 팀 포함, 목록에서는 숨겨짐)
      await setDoc(doc(db,"companies",companyId,"meta","config"), {
        teams: INIT_TEAMS,
        linkCategories: ["업무", "지도", "연락처", "기타"],
      });
      const user = {uid:adminId, id:id.trim(), name:id.trim(), companyId, companyName:"", role:"최고관리자", team:"사장", needsSetup:true};
      try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
      onLogin(user);
    } catch(e) {
      console.error(e);
      setError("가입 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // ── 비밀번호 설정 화면 (첫 로그인) ──
  if(mode==="notifyConsent") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-8">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#f59e0b,#d97706)"}}>🔔</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-3 text-center">알림 받기</h1>
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            새로운 청소 일정이 등록되면<br/>
            <span className="font-bold text-gray-800">스마트폰 알림</span>으로 바로 알려드려요.
          </p>
          <div className="mt-6 w-full bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-xs text-amber-700 leading-relaxed">
              📌 업무 일정을 놓치지 않으려면 알림을 켜는 것을 권장합니다.<br/>
              다음 화면에서 <span className="font-bold">"허용"</span>을 눌러주세요.
            </p>
          </div>
        </div>
        <button onClick={handleNotifyConsent} disabled={loading}
          className="w-full py-4 rounded-2xl text-white text-base font-bold"
          style={{background:"linear-gradient(135deg,#f59e0b,#d97706)",opacity:loading?0.7:1}}>
          {loading ? "설정 중..." : "🔔 알림 받기"}
        </button>
        <button onClick={() => onLogin(pendingUser)} disabled={loading}
          className="w-full py-3 mt-2 text-sm text-gray-400 font-semibold">
          나중에 설정
        </button>
      </div>
    );
  }

  if(mode==="setPw") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#16a34a,#15803d)"}}>👋</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">처음 오셨군요!</h1>
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            <span className="font-bold text-gray-800">{pendingUser?.name}</span>님,<br/>
            사용할 비밀번호를 설정해주세요.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="p-4 rounded-2xl bg-green-50 border border-green-100 mb-1">
            <p className="text-sm font-bold text-green-600 mb-1">📱 로그인 정보</p>
            <p className="text-xs text-gray-500">전화번호: <span className="font-bold text-gray-800">{id}</span></p>
            <p className="text-xs text-gray-400 mt-1">다음부터 이 번호 + 비밀번호로 로그인해요.</p>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="새 비밀번호 (4자 이상)" value={pw}
              onChange={e=>{setPw(e.target.value);setError("");}}
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw?"border-green-400":"border-gray-200")}/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 확인" value={pw2}
              onChange={e=>{setPw2(e.target.value);setError("");}}
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw2?(pw===pw2?"border-green-400":"border-red-400"):"border-gray-200")}/>
            {pw2&&<span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">{pw===pw2?"✅":"❌"}</span>}
          </div>
          {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
          <button onClick={handleSetPw} disabled={loading}
            className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
            style={{background:pw&&pw2?"linear-gradient(135deg,#16a34a,#15803d)":"#e5e7eb",opacity:loading?0.7:1}}>
            {loading?"설정 중...":"비밀번호 설정하고 시작하기"}
          </button>
        </div>
      </div>
    );
  }

  // ── 업체 가입 화면 ──
  if(mode==="register") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-6">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>🧹</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-1">클린메니져</h1>
          <p className="text-base font-bold text-blue-600 mb-2 tracking-widest uppercase">clean-manager</p>
          <p className="text-sm text-gray-400 font-medium">청소업체 관리 솔루션</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-gray-700">회원가입</p>
            <button onClick={()=>{setMode("login");setError("");}}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
              <X size={18} className="text-gray-600"/>
            </button>
          </div>
          <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 mb-1">
            <p className="text-sm font-bold text-blue-600 mb-1">🏢 업체 대표 계정 만들기</p>
            <p className="text-xs text-gray-500 leading-relaxed">회사명·로고는 가입 후 앱 설정에서 언제든 변경할 수 있어요.</p>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">👤</span>
            <input placeholder="아이디 (숫자 0으로 시작하면 안됩니다.)" value={id}
              onChange={e=>{
                const v = e.target.value;
                setId(v);
                setError(v.startsWith("0") ? "⛔ 아이디는 숫자 0으로 시작할 수 없습니다!" : "");
              }}
              className={"w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(id.startsWith("0")?"border-red-400":id?"border-blue-400":"border-gray-200")}/>
            {id.startsWith("0") && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-red-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg">
                ⛔ 0으로 시작하는 아이디는 사용할 수 없습니다
                <div className="absolute -top-1.5 left-6 w-3 h-3 bg-red-500 rotate-45"/>
              </div>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 (4자 이상)" value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              autoComplete="new-password"
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw?"border-blue-400":"border-gray-200")}/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 확인" value={pw2} onChange={e=>{setPw2(e.target.value);setError("");}}
              autoComplete="new-password"
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw2?(pw===pw2?"border-green-400":"border-red-400"):"border-gray-200")}/>
            {pw2&&<span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">{pw===pw2?"✅":"❌"}</span>}
          </div>
          {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
          <button onClick={handleRegister} disabled={loading}
            className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
            style={{background:id&&pw&&pw2?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb",opacity:loading?0.7:1}}>
            {loading?"가입 중...":"가입하기"}
          </button>
        </div>
      </div>
    );
  }

  // ── 로그인 화면 ──
  return (
    <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
      <div className="flex flex-col items-center justify-center px-2 mb-8">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl"
          style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>🧹</div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-1">클린메니져</h1>
        <p className="text-base font-bold text-blue-600 mb-2 tracking-widest uppercase">clean-manager</p>
        <p className="text-sm text-gray-400 font-medium">청소업체 관리 솔루션</p>
      </div>
      <div className="flex flex-col gap-3">
        {/* 아이디/전화번호 — 전화번호면 하이픈 자동 삽입 */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">👤</span>
          <input placeholder="아이디 또는 전화번호" value={id}
            onChange={e=>{
              const raw = e.target.value;
              if (/^0\d*[-\d]*$/.test(raw.replace(/-/g,"")) || raw === "") {
                // 전화번호 패턴이면 하이픈 자동 삽입
                const digits = raw.replace(/\D/g,"").slice(0,11);
                const fmt = digits.length <= 3 ? digits
                  : digits.length <= 7 ? `${digits.slice(0,3)}-${digits.slice(3)}`
                  : `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
                setId(fmt);
              } else {
                setId(raw);
              }
              setError(""); setPw("");
            }}
            className={"w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(id?"border-blue-400":"border-gray-200")}/>
        </div>
        {/* 비밀번호 — 최초 로그인이면 숨김 */}
        {(id && !isPhone(id)) && (
          // 관리자 아이디 로그인
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호"
              value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border border-gray-200"/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
        )}
        {(phoneComplete(id) && hasPw === true) && (
          // 전화번호 + 비밀번호 있는 직원
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호"
              value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border border-gray-200"/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
        )}
        {(phoneComplete(id) && hasPw === false) && (
          // 최초 로그인 — 비밀번호 필드 없이 안내 메시지
          <div className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-600 font-semibold">
            👋 처음 로그인하시는군요! 로그인 버튼을 누르면 비밀번호를 설정할 수 있습니다.
          </div>
        )}
        {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
        <button onClick={handleLogin} disabled={loading}
          className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
          style={{background:id?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb",opacity:loading?0.7:1}}>
          {loading?"확인 중...":"로그인"}
        </button>
        <p className="text-sm text-gray-400 text-center mt-1">
          처음 사용하시나요?{" "}
          <button onClick={()=>{setMode("register");setError("");setId("");setPw("");}}
            className="text-blue-500 font-bold border-none bg-transparent cursor-pointer text-sm">
            회원가입
          </button>
        </p>
      </div>
      {/* 다중 소속 회사 선택 모달 */}
      {multiCompanies && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-3xl text-center mb-2">🏢</div>
            <h2 className="text-lg font-extrabold text-gray-900 text-center mb-1">소속 회사 선택</h2>
            <p className="text-sm text-gray-400 text-center mb-5">여러 업체에 등록되어 있습니다.<br/>어느 업체로 로그인할까요?</p>
            <div className="flex flex-col gap-3">
              {multiCompanies.companies.map(({ staffDoc, companyName }) => (
                <button key={staffDoc.id}
                  onClick={async () => {
                    const data = staffDoc.data();
                    const user = { ...data, uid: staffDoc.id, companyName };
                    try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch {}
                    setMultiCompanies(null);
                    onLogin(user);
                  }}
                  className="w-full py-4 rounded-2xl font-bold text-sm text-white"
                  style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
                  {companyName}
                </button>
              ))}
              <button onClick={() => setMultiCompanies(null)}
                className="w-full py-3 rounded-2xl font-bold text-sm text-gray-500 bg-gray-100">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 데모 배너 ────────────────────────────────────────────────────
export function DemoBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center gap-2 px-4 py-2 bg-amber-400 max-w-sm mx-auto"
      style={{boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
      <span className="text-sm font-bold text-amber-900 flex-1">🎭 데모 모드 — 실제 데이터에 영향 없음</span>
      <button onClick={()=>setVisible(false)} className="text-amber-800 font-bold text-lg leading-none">×</button>
    </div>
  );
}

// ── 앱 내부 뼈대 (로그인 후 메인 화면 라우팅) ───────────────────────────────────────────────
export function SetupCompanyModal() {
  const { currentUser } = useC();
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!companyName.trim()) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, "companies", currentUser.companyId), { name: companyName.trim() });
      await updateDoc(doc(db, "admins", currentUser.uid), { companyName: companyName.trim() });
      try {
        const saved = JSON.parse(localStorage.getItem("loginUser") || "{}");
        localStorage.setItem("loginUser", JSON.stringify({ ...saved, companyName: companyName.trim(), needsSetup: false }));
      } catch {}
      window.location.reload();
    } catch(e) {
      alert("오류: " + e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center px-6">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
        <div className="text-4xl text-center mb-3">🏢</div>
        <h2 className="text-xl font-extrabold text-gray-900 text-center mb-1">회사명을 입력해주세요</h2>
        <p className="text-sm text-gray-400 text-center mb-6">앱 전체에 표시되는 회사 이름입니다</p>
        <input
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder="예) 크린드림 청소"
          autoFocus
          className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm font-bold outline-none focus:border-blue-500 mb-4"
        />
        <button
          onClick={handleSave}
          disabled={!companyName.trim() || loading}
          className="w-full py-4 rounded-xl text-white font-bold text-sm transition-all"
          style={{ background: companyName.trim() ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb" }}>
          {loading ? "저장 중..." : "시작하기"}
        </button>
      </div>
    </div>
  );
}

// ── 아이폰 홈 화면 추가 안내 배너 ───────────────────────────────────
export function IphoneInstallGuide() {
  const [closed, setClosed] = useState(false);

  // 강제 미리보기: 주소 뒤에 #iphonebanner 붙이면 어떤 기기에서도 표시
  const forcePreview = typeof window !== "undefined" && window.location.hash.includes("iphonebanner");

  const isIOS = typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  // 이미 홈 화면 앱으로 실행 중이면 안내 불필요
  const isStandalone = typeof window !== "undefined" &&
    (window.navigator.standalone === true ||
     window.matchMedia?.("(display-mode: standalone)")?.matches);
  // 이 세션에서 이미 닫았으면 다시 안 띄움
  const dismissed = typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("iphoneGuideDismissed") === "1";

  // 닫기(closed)를 최우선으로 — 미리보기 모드에서도 X 누르면 닫힘
  const show = !closed && (forcePreview || (isIOS && !isStandalone && !dismissed));
  if (!show) return null;

  const close = () => {
    setClosed(true);
    // 미리보기(#iphonebanner) 상태면 해시 제거해서 다시 안 뜨게
    if (forcePreview) { try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {} }
    try { sessionStorage.setItem("iphoneGuideDismissed", "1"); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-end justify-center bg-black/50" onClick={close}>
      <div className="w-full max-w-sm bg-white rounded-t-3xl p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-gray-900">📱 알림 받기 설정</h2>
          <button onClick={close} className="p-1 text-gray-400"><X size={22}/></button>
        </div>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          아이폰은 <span className="font-bold text-gray-800">홈 화면에 추가</span>해야<br/>
          청소 일정 알림을 받을 수 있어요. 아래 순서대로 해주세요!
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">1</div>
            <p className="text-sm text-gray-800">
              사파리 아래쪽 <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-100 text-blue-600 font-bold align-middle">⬆️</span> <span className="font-bold">공유 버튼</span>을 누르세요
            </p>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">2</div>
            <p className="text-sm text-gray-800">
              메뉴에서 <span className="font-bold">"홈 화면에 추가"</span>를 누르세요
            </p>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">3</div>
            <p className="text-sm text-gray-800">
              홈 화면에 생긴 <span className="font-bold">🧹 클린메니져 아이콘</span>으로 다시 열어주세요
            </p>
          </div>
        </div>

        <div className="mt-5 bg-amber-50 border border-amber-100 rounded-2xl p-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            ⚠️ 이렇게 안 하면 아이폰에서는 알림이 오지 않아요.<br/>
            잘 모르겠으면 팀장님께 도움을 요청하세요.
          </p>
        </div>

        <button onClick={close}
          className="w-full mt-4 py-3.5 rounded-2xl text-sm font-bold text-gray-500 bg-gray-100">
          나중에 하기
        </button>
      </div>
    </div>
  );
}

