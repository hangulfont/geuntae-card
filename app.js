// 근태카드 — GitHub Pages + Firebase(Auth, Firestore)
import config from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo") || !config || !config.apiKey || String(config.apiKey).startsWith("YOUR");

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const pad = (n) => String(n).padStart(2, "0");
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmtH = (h) => (Math.round(h * 10) / 10).toString().replace(/\.0$/, "");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 2026 대한민국 공휴일 (대체공휴일 포함)
const HOLIDAYS = {
  "2026-01-01": "신정", "2026-02-16": "설날", "2026-02-17": "설날", "2026-02-18": "설날",
  "2026-03-01": "삼일절", "2026-03-02": "대체공휴일", "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일", "2026-06-03": "지방선거", "2026-06-06": "현충일",
  "2026-08-15": "광복절", "2026-08-17": "대체공휴일", "2026-09-24": "추석", "2026-09-25": "추석", "2026-09-26": "추석",
  "2026-10-03": "개천절", "2026-10-05": "대체공휴일", "2026-10-09": "한글날", "2026-12-25": "성탄절",
};
const TYPES = { work: "근무", am: "오전반차", pm: "오후반차", leave: "연차", holiday: "특근", trip: "출장" };
const LEAVE_DAYS = { leave: 1, am: 0.5, pm: 0.5 };
const isLeave = (t) => t in LEAVE_DAYS;
const LEAVE_PARTS = { leave: [["연차", 0]], am: [["오전", 0], ["반차", 1]], pm: [["오후", 0], ["반차", 1]] };
const OT_CHIPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4];
const HW_CHIPS = [2, 4, 6, 8, 9, 10];
// 근무조건: 08:00~17:00 (점심 12:00~13:00, 8시간), 잔업은 17:30부터 30분 단위
const DEFAULT_STD = { start: "08:00", end: "17:00", otStart: "17:30" };
const LUNCH = ["12:00", "13:00"];
const stdOf = (uid) => ({ ...DEFAULT_STD, ...(docOf(uid).std || {}) });
// 자동 출근 시각: 기록된 값 > 오전반차 13:00 > 정규 출근
const autoIn = (e, std) => (e && e.in) || (e && e.type === "am" ? "13:00" : (std || DEFAULT_STD).start);
// 주말·공휴일 = 특근일
const isOffDay = (k) => { const [y, m, d] = k.split("-").map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 || w === 6 || !!HOLIDAYS[k]; };

// ---------------- state ----------------
const S = {
  mode: DEMO ? "demo" : "firebase",
  myId: null, myEmail: "", isAdmin: false,
  docs: {}, access: null, requests: [],
  viewUid: null, tab: "me", stale: false,
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
};
const docOf = (uid) => S.docs[uid] || { site: "", nick: "", name: "", std: { ...DEFAULT_STD }, days: {} };
const nameOf = (uid) => docOf(uid).nick || docOf(uid).name || (uid === S.myId ? "나" : "이름 없음");
const canWrite = (uid) => uid === S.myId || S.isAdmin;

// ---------------- store: demo ----------------
const DEMO_KEY = "geuntae-demo-v4";
function demoStore() {
  let data;
  try { data = JSON.parse(localStorage.getItem(DEMO_KEY) || "null"); } catch (_) { data = null; }
  if (!data) data = buildDemo();
  const persist = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch (_) {} };
  persist();
  let listener = () => {};
  const emit = () => listener(JSON.parse(JSON.stringify(data)));
  return {
    subscribe(cb) { listener = cb; emit(); },
    async saveDay(uid, date, entry) {
      data[uid] = data[uid] || { days: {} };
      if (entry === null) delete data[uid].days[date]; else data[uid].days[date] = entry;
      persist(); emit();
    },
    async saveProfile(uid, patch) { data[uid] = { ...(data[uid] || { days: {} }), ...patch }; persist(); emit(); },
    reset() { try { localStorage.removeItem(DEMO_KEY); } catch (_) {} location.reload(); },
  };
}
function buildDemo() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const mk = (seed, site, name, pattern) => {
    const days = {};
    for (let d = 1; d < now.getDate(); d++) {
      const dt = new Date(y, m, d), k = dkey(dt), w = dt.getDay();
      if (w === 0 || w === 6 || HOLIDAYS[k]) continue;
      const p = pattern[(d + seed) % pattern.length];
      if (p === "leave") { days[k] = { type: "leave" }; continue; }
      if (p === "am") { days[k] = { type: "am", in: "13:00", out: "17:05", ot: 0 }; continue; }
      if (p === "pm") { days[k] = { type: "pm", in: "08:00", out: "12:00", ot: 0 }; continue; }
      days[k] = { type: "work", in: `07:${pad(40 + ((d * 7 + seed) % 19))}`, out: p, ot: suggestOT(p, DEFAULT_STD) };
    }
    return { name, nick: "", site, std: { ...DEFAULT_STD }, days };
  };
  const A = ["17:05", "19:40", "18:35", "17:10", "20:45", "leave", "17:02", "am", "19:30"];
  const data = {
    demo_me: mk(1, "예시) 한빛전자 평택공장", "예시 사용자", A),
    demo_b: mk(3, "예시) 대성정밀 2공장", "김상주", A.slice().reverse()),
    demo_c: mk(5, "예시) 한빛전자 평택공장", "이현장", A),
    demo_d: mk(7, "", "박정비", ["17:05", "18:40", "17:10", "leave", "19:35", "17:02", "18:05"]),
    demo_e: mk(2, "", "최설비", ["18:35", "17:05", "20:10", "17:00", "pm", "17:20", "19:00"]),
  };
  // 주말 특근 예시: 이번 달 첫 토요일
  for (let d = 1; d < now.getDate(); d++) {
    const dt = new Date(y, m, d);
    if (dt.getDay() === 6) { data.demo_b.days[dkey(dt)] = { type: "holiday", in: "08:00", out: "15:10", hw: holidayHours("08:00", "15:10", DEFAULT_STD) }; break; }
  }
  data.demo_b.days[dkey(now)] = { type: "work", in: "07:52" };
  data.demo_c.days[dkey(now)] = { type: "work", in: "07:49", out: "19:05", ot: suggestOT("19:05", DEFAULT_STD) };
  return data;
}

// ---------------- store: firebase ----------------
let store = null, FBX = null;
async function firebaseBoot() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "ko";
  await A.setPersistence(auth, A.browserLocalPersistence); // 로그아웃 전까지 로그인 유지
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (_) { db = F.getFirestore(app); }
  FBX = { A, F, auth, db };

  store = {
    subscribe(cb) {
      return F.onSnapshot(F.collection(db, "att"), { includeMetadataChanges: true }, (snap) => {
        const out = {};
        snap.docs.forEach((d) => { out[d.id] = d.data(); });
        S.stale = snap.metadata.fromCache && !navigator.onLine;
        S.cacheOnly = snap.metadata.fromCache;
        cb(out);
      }, (err) => { console.error(err); S.stale = true; toast("기록을 불러오지 못했습니다. 권한 또는 네트워크를 확인하세요."); render(); });
    },
    saveDay(uid, date, entry) {
      const ref = F.doc(db, "att", uid);
      const path = new F.FieldPath("days", date);
      const p = entry === null ? F.updateDoc(ref, path, F.deleteField())
        : F.updateDoc(ref, path, entry).catch((e) => {
            if (e.code === "not-found") return F.setDoc(ref, { days: { [date]: entry } }, { merge: true });
            throw e;
          });
      return p;
    },
    saveProfile(uid, patch) { return F.setDoc(F.doc(db, "att", uid), patch, { merge: true }); },
  };

  A.onAuthStateChanged(auth, (u) => {
    stopAll();
    if (!u) { showGate("login"); return; }
    S.myId = u.uid; S.myEmail = (u.email || "").toLowerCase(); S.viewUid = u.uid;
    S._user = u;
    showGate("loading");
    const accRef = F.doc(db, "config", "access");
    unsubs.push(F.onSnapshot(accRef, (snap) => {
      if (!snap.exists()) { S.access = null; showGate("setup"); return; }
      const acc = snap.data();
      S.access = { admins: (acc.admins || []).map((x) => x.toLowerCase()), members: (acc.members || []).map((x) => x.toLowerCase()) };
      S.isAdmin = S.access.admins.includes(S.myEmail);
      const member = S.isAdmin || S.access.members.includes(S.myEmail);
      if (!member) {
        // 승인 요청: 본인이 이름을 입력해서 보냄 (이미 보냈으면 보낸 이름을 보여줌)
        F.getDoc(F.doc(db, "requests", u.uid)).then((r) => { S.myRequest = r.exists() ? r.data() : null; showGate("pending"); })
          .catch(() => { S.myRequest = null; showGate("pending"); });
        return;
      }
      startApp();
    }, (err) => { console.error(err); showGate("error", err.code); }));
  });
}
const unsubs = []; let appStarted = false;
function stopAll() { while (unsubs.length) { try { unsubs.pop()(); } catch (_) {} } appStarted = false; }

function startApp() {
  if (appStarted) { render(); return; }
  appStarted = true;
  showGate(null);
  if (S.mode === "firebase") {
    const u = S._user, { F, db } = FBX;
    store.saveProfile(u.uid, { name: u.displayName || "", email: u.email || "" }).catch(() => {});
    let asked = false;
    unsubs.push(store.subscribe((docs) => {
      S.docs = normalize(docs); render();
      // 표시 이름을 아직 정하지 않았으면 한 번 입력받음 (Google 닉네임 대신)
      if (!asked && !S.cacheOnly && S.docs[S.myId] && !S.docs[S.myId].nick) { asked = true; openName(true); }
    }));
    if (S.isAdmin) {
      unsubs.push(F.onSnapshot(F.collection(db, "requests"), (snap) => {
        S.requests = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        render();
      }, () => {}));
    }
  } else {
    store.subscribe((docs) => { S.docs = normalize(docs); render(); });
  }
}
function normalize(docs) {
  const out = {};
  Object.entries(docs).forEach(([uid, v]) => {
    out[uid] = { name: v.name || "", nick: v.nick || "", site: v.site || "", email: v.email || "", std: v.std || { ...DEFAULT_STD },
      days: Object.fromEntries(Object.entries(v.days || {}).filter(([, x]) => x)) };
  });
  return out;
}

// ---------------- writes ----------------
const queues = {};
function saveDay(uid, date, entry) {
  const cur = docOf(uid), days = { ...cur.days };
  if (entry === null) delete days[date]; else days[date] = entry;
  S.docs[uid] = { ...cur, days }; render();
  return enqueue(uid, () => store.saveDay(uid, date, entry));
}
function saveProfile(uid, patch) {
  S.docs[uid] = { ...docOf(uid), ...patch }; render();
  return enqueue(uid, () => store.saveProfile(uid, patch));
}
function enqueue(uid, fn) {
  const p = (queues[uid] || Promise.resolve()).then(fn).catch((err) => {
    console.error(err);
    toast(err && err.code === "permission-denied" ? "저장 권한이 없습니다. 관리자에게 멤버 승인을 요청하세요." : "저장하지 못했습니다. 네트워크를 확인하고 다시 눌러주세요.");
  });
  queues[uid] = p; return p;
}

// 잔업: 잔업 시작(17:30)부터 퇴근 시각까지, 30분 단위 내림. 예) 18:35 퇴근 → 65분 → 1시간
function suggestOT(outT, std) {
  const st = toMin((std && std.otStart) || DEFAULT_STD.otStart), o = toMin(outT);
  if (o == null || st == null) return 0;
  let diff = o - st; if (diff < 0 && o < 6 * 60) diff += 24 * 60; // 자정 이후 퇴근
  return diff < 30 ? 0 : Math.floor(diff / 30) * 0.5;
}
// 특근: 출근~퇴근 중 점심(12~13)과 17:00~17:30 휴게를 빼고 30분 단위 내림
function holidayHours(inT, outT, std) {
  const a = toMin(inT); let b = toMin(outT);
  if (a == null || b == null) return 0;
  if (b <= a) b += 24 * 60;
  const overlap = (s, e) => Math.max(0, Math.min(b, e) - Math.max(a, s));
  const s = std || DEFAULT_STD;
  let mins = b - a - overlap(toMin(LUNCH[0]), toMin(LUNCH[1])) - overlap(toMin(s.end), toMin(s.otStart));
  return mins < 30 ? 0 : Math.floor(mins / 30) * 0.5;
}

// ---------------- gate screens ----------------
function inAppBrowser() {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND/i.test(ua)) return "other";
  return null;
}
function showGate(kind, code) {
  const gate = $("#gate"), app = $("#app");
  if (!kind) { gate.hidden = true; app.hidden = false; return; }
  gate.hidden = false; app.hidden = true;
  const title = $("#gate-title"), msg = $("#gate-msg"), mail = $("#gate-mail"), foot = $("#gate-foot");
  const g = $("#btn-google"), setup = $("#btn-setup"), lo = $("#btn-gate-logout"), ia = $("#inapp"), nf = $("#gate-name");
  [g, setup, lo, mail, ia, nf].forEach((x) => (x.hidden = true));
  foot.textContent = "";
  mail.textContent = S.myEmail;
  if (kind === "loading") { title.textContent = "근태카드"; msg.textContent = "불러오는 중…"; return; }
  if (kind === "login") {
    title.textContent = "근태카드";
    msg.innerHTML = "출근·퇴근과 잔업을 기록하려면 로그인하세요.<br>한 번 로그인하면 로그아웃할 때까지 유지됩니다.";
    g.hidden = false;
    const iab = inAppBrowser();
    if (iab) {
      ia.hidden = false;
      ia.innerHTML = iab === "kakao"
        ? "<b>카카오톡 안에서는 Google 로그인이 막혀 있습니다.</b><br>아래 버튼으로 기본 브라우저에서 여세요. (아이폰은 오른쪽 아래 ⋯ → '다른 브라우저로 열기')"
        : "<b>앱 안의 브라우저에서는 Google 로그인이 안 될 수 있습니다.</b><br>메뉴에서 'Chrome/Safari로 열기'를 눌러주세요.";
      if (iab === "kakao") {
        const b = document.createElement("button"); b.className = "ghost"; b.textContent = "기본 브라우저로 열기";
        b.onclick = () => { location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href); };
        ia.append(b);
      }
    }
    foot.textContent = "회사에서 승인한 계정만 기록을 볼 수 있습니다.";
    return;
  }
  if (kind === "pending") {
    const req = S.myRequest;
    mail.hidden = false; lo.hidden = false; nf.hidden = false;
    if (req) {
      title.textContent = "승인 대기 중";
      msg.textContent = `'${req.name}' 이름으로 승인 요청을 보냈습니다. 관리자가 승인하면 바로 사용할 수 있습니다.`;
      $("#gate-name-input").value = req.name || "";
      $("#btn-request").textContent = "이름 고쳐서 다시 보내기";
    } else {
      title.textContent = "이름 입력";
      msg.textContent = "달력과 팀 현황에 표시될 본인 이름을 입력하고 승인 요청을 보내세요.";
      $("#btn-request").textContent = "승인 요청 보내기";
    }
    return;
  }
  if (kind === "setup") {
    title.textContent = "처음 설정";
    msg.textContent = "아직 관리자가 없습니다. 이 계정을 관리자로 등록하면 다른 사람의 가입을 승인할 수 있습니다.";
    mail.hidden = false; setup.hidden = false; lo.hidden = false;
    return;
  }
  title.textContent = "접속 오류";
  msg.textContent = `데이터에 접근하지 못했습니다 (${code || "unknown"}). firestore.rules 가 배포됐는지 확인하세요.`;
  lo.hidden = false;
}

// ---------------- render ----------------
function render() {
  if ($("#app").hidden) return;
  renderHeader(); renderPunch(); renderCalendar(); renderTeam();
}
function renderHeader() {
  $("#tab-me").setAttribute("aria-selected", S.tab === "me");
  $("#tab-team").setAttribute("aria-selected", S.tab === "team");
  $("#view-me").hidden = S.tab !== "me"; $("#view-team").hidden = S.tab !== "team";
  const b = $("#banner");
  if (S.mode === "demo") {
    b.hidden = false;
    b.innerHTML = "<b>데모 모드</b> · 예시 데이터로 동작을 보여줍니다. 기록은 이 브라우저에만 저장됩니다. ";
    const r = document.createElement("button"); r.className = "linkbtn"; r.textContent = "예시 초기화"; r.onclick = () => store.reset(); b.append(r);
  } else if (S.stale) { b.hidden = false; b.textContent = "오프라인 상태입니다. 기록은 저장해 두었다가 연결되면 자동으로 올라갑니다."; }
  else b.hidden = true;
  const who = $("#whoami"); who.innerHTML = "";
  who.append(el("b", null, nameOf(S.myId)), " ✎");
  const badge = $("#req-badge");
  badge.hidden = !(S.isAdmin && S.requests.length); badge.textContent = S.requests.length;
}

function renderPunch() {
  const now = new Date(), k = dkey(now), uid = S.viewUid, mine = uid === S.myId;
  $("#punch").hidden = !mine;
  const v = $("#viewing");
  if (!mine && uid) {
    v.hidden = false; v.innerHTML = "";
    const s = document.createElement("span"); s.textContent = `${nameOf(uid)}님의 근태를 보고 있습니다${canWrite(uid) ? " (관리자 수정 가능)" : ""}`;
    const bk = document.createElement("button"); bk.className = "ghost"; bk.textContent = "내 근태로";
    bk.onclick = () => { S.viewUid = S.myId; render(); };
    v.append(s, bk);
  } else v.hidden = true;
  if (!mine) return;

  $("#today-label").textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 (${DOW[now.getDay()]})${HOLIDAYS[k] ? " · " + HOLIDAYS[k] : ""}`;
  const e = docOf(uid).days[k] || {};
  const std = stdOf(uid);
  const fullLeave = e.type === "leave";
  $$("#leave-row button").forEach((b) => b.setAttribute("aria-pressed", e.type === b.dataset.type));

  const bi = $("#btn-in"), bo = $("#btn-out");
  const setBtn = (b, cls, lbl, sub) => { b.className = "pbtn " + cls; b.querySelector(".lbl").textContent = lbl; b.querySelector(".sub").textContent = sub; };
  if (fullLeave) { setBtn(bi, "done", "연차", "오늘은 연차입니다"); setBtn(bo, "done", "—", "기록 없음"); }
  else {
    const hw = e.type === "holiday" || (!e.type && isOffDay(k));
    // 출근은 자동 처리 (버튼 비활성)
    if (hw) setBtn(bi, "done", "특근", `${HOLIDAYS[k] || "주말"} · 퇴근 때 출근시각 입력`);
    else setBtn(bi, "done", `출근 ${autoIn(e, std)}`, e.type === "am" ? "오전반차 · 자동 처리" : "자동 처리");
    if (e.out) setBtn(bo, "done", e.out, hw ? `특근 ${fmtH(e.hw || 0)}시간 · 눌러서 수정` : `잔업 ${fmtH(e.ot || 0)}시간 · 눌러서 수정`);
    else setBtn(bo, "out", "퇴근", hw ? "특근 시간 입력" : e.type === "pm" ? "오후반차 · 퇴근 기록" : "누르면 퇴근·잔업 기록");
  }
  bi.disabled = true;
  bo.disabled = fullLeave;

  const row = $("#stamp-row"); row.innerHTML = "";
  const t = document.createElement("span"); t.textContent = `정규 ${std.start}~${std.end} · 점심 ${LUNCH[0]}~${LUNCH[1]} · 잔업 ${std.otStart}부터`; row.append(t);
  const set = document.createElement("button"); set.textContent = "내 설정"; set.onclick = openSettings; row.append(set);
}

// 사람별 고정 색상 (6가지). uid 해시로 자리를 잡고, 겹치면 다음 빈 색으로
const PERSON_COLORS = 6;
function personOrder() {
  return Object.keys(S.docs).sort((a, b) => (a === S.myId ? -1 : b === S.myId ? 1 : nameOf(a).localeCompare(nameOf(b), "ko")));
}
function personColors() {
  const map = {}, used = new Set();
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  Object.keys(S.docs).sort().forEach((uid) => {
    let i = hash(uid) % PERSON_COLORS, n = 0;
    while (used.has(i) && n < PERSON_COLORS) { i = (i + 1) % PERSON_COLORS; n++; }
    used.add(i); map[uid] = i;
  });
  return map;
}
// 휴대폰용 짧은 이름: 한글 3~4자는 성을 뺀 이름(김상주→상주), 띄어쓰기가 있으면 첫 단어
function shortName(n) {
  n = String(n || "").trim();
  if (/s/.test(n)) n = n.split(/s+/)[0];
  if (/^[가-힣]{3,4}$/.test(n)) return n.slice(1);
  return n.slice(0, 3);
}
// 그날 표시할 내용: 잔업 / 특근 / 휴가
function dayMark(e) {
  if (!e) return null;
  if (e.type === "holiday" && (e.hw > 0 || e.out)) return { cls: "hw", text: `특${fmtH(e.hw || 0)}h` };
  if (e.ot > 0) return { cls: "ot", text: `${fmtH(e.ot)}h` };
  if (isLeave(e.type)) return { cls: "lv", text: e.type === "leave" ? "연차" : e.type === "am" ? "오전" : "오후" };
  return null;
}

function renderCalendar() {
  const uid = S.viewUid, doc = docOf(uid);
  const y = S.month.getFullYear(), m = S.month.getMonth();
  $("#month-title").textContent = `${y}년 ${m + 1}월`;
  $$(".dows").forEach((dows) => {
    if (dows.childElementCount) return;
    DOW.forEach((d, i) => { const x = document.createElement("div"); x.className = "dow" + (i === 0 ? " sun" : i === 6 ? " sat" : ""); x.textContent = d; dows.append(x); });
  });
  const grid = $("#days"); grid.innerHTML = "";
  const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  const todayK = dkey(new Date());
  const people = personOrder(), colors = personColors();
  for (let i = 0; i < first; i++) { const b = document.createElement("div"); b.className = "day blank"; grid.append(b); }
  let workDays = 0, otSum = 0, leaveDays = 0, hwSum = 0;
  const add = (cell, cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; cell.append(s); return s; };
  for (let d = 1; d <= last; d++) {
    const dt = new Date(y, m, d), k = dkey(dt), w = dt.getDay(), e = doc.days[k];
    const cell = document.createElement("button");
    cell.className = "day" + (w === 0 ? " sun" : w === 6 ? " sat" : "") + (HOLIDAYS[k] ? " hol" : "") + (k === todayK ? " today" : "");
    cell.setAttribute("aria-label", `${m + 1}월 ${d}일`);
    add(cell, "d", d);
    if (HOLIDAYS[k]) add(cell, "hn", HOLIDAYS[k]);
    // 월 합계 (보고 있는 사람 기준)
    if (e) {
      if (isLeave(e.type)) leaveDays += LEAVE_DAYS[e.type];
      if (e.ot) otSum += e.ot;
      if (e.type === "holiday") hwSum += e.hw || 0;
      if (e.out && e.type !== "leave") workDays++;
    }
    // 모든 사람: 같은 순서·같은 색으로 "이름 잔업시간"
    people.forEach((pu) => {
      const mk = dayMark(S.docs[pu].days[k]); if (!mk) return;
      const r = document.createElement("span");
      r.className = `pc ${mk.cls}${pu === uid ? " me" : ""}`;
      r.style.setProperty("--pc", `var(--p${colors[pu]})`);
      r.append(el("span", "nm nm-full", nameOf(pu)), el("span", "nm nm-short", shortName(nameOf(pu))), el("b", null, mk.text));
      cell.append(r);
    });
    cell.onclick = () => openDay(uid, k);
    grid.append(cell);
  }
  // 범례: 사람별 색 + 표기 설명
  const lg = $("#legend"); lg.innerHTML = "";
  people.forEach((pu) => { const s = el("span", "lg-p", nameOf(pu)); s.style.setProperty("--pc", `var(--p${colors[pu]})`); lg.append(s); });
  lg.append(el("span", "lg-k", "숫자=잔업 · 특=특근"));
  const sum = $("#sum"); sum.innerHTML = "";
  [["근무", workDays + "일", ""], ["잔업", fmtH(otSum) + "h", "o"], ["특근", fmtH(hwSum) + "h", "h"], ["연차", fmtH(leaveDays) + "일", ""]]
    .forEach(([l, v, c]) => {
      const d = document.createElement("div"); d.className = c;
      const s = document.createElement("small"); s.textContent = l; const st = document.createElement("strong"); st.textContent = v;
      d.append(s, st); sum.append(d);
    });
}

function renderTeam() {
  const tb = $("#team-body"); tb.innerHTML = "";
  const k = dkey(new Date()), mk_ = mkey(S.month);
  $("#team-title").textContent = `팀 현황 · ${S.month.getMonth() + 1}월`;
  $("#admin-row").hidden = !S.isAdmin;
  $("#btn-members").textContent = S.requests.length ? `멤버 관리 (승인 대기 ${S.requests.length})` : "멤버 관리";
  const list = Object.keys(S.docs).sort((a, b) => (a === S.myId ? -1 : b === S.myId ? 1 : nameOf(a).localeCompare(nameOf(b), "ko")));
  if (!list.length) {
    const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 9; td.className = "empty";
    td.textContent = "아직 기록한 사람이 없습니다. 멤버를 승인하고 출근을 눌러달라고 하세요."; tr.append(td); tb.append(tr); return;
  }
  list.forEach((uid) => {
    const doc = docOf(uid), e = doc.days[k] || {};
    let otM = 0, hwM = 0, wd = 0;
    Object.entries(doc.days).forEach(([dk, v]) => { if (dk.startsWith(mk_)) { otM += v.ot || 0; hwM += v.hw || 0; if (v.in) wd++; } });
    let st = ["none", "미출근"];
    if (isLeave(e.type) && !e.in) st = ["lv", TYPES[e.type]];
    else if (e.out) st = ["left", "퇴근"]; else if (e.in) st = ["working", e.type === "holiday" ? "특근중" : "근무중"];
    const tr = document.createElement("tr"); tr.className = "click";
    const todayExtra = e.out ? (e.type === "holiday" ? `특 ${fmtH(e.hw || 0)}h` : fmtH(e.ot || 0) + "h") : "—";
    const cells = [nameOf(uid) + (uid === S.myId ? " (나)" : ""), null, e.in || "—", e.out || "—", todayExtra, fmtH(otM) + "h", fmtH(hwM) + "h", wd + "일"];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if (i === 1) { const s = document.createElement("span"); s.className = "status " + st[0]; s.textContent = st[1]; td.append(s); }
      else td.textContent = c;
      if (i >= 2) td.className = "num";
      tr.append(td);
    });
    tr.onclick = () => { S.viewUid = uid; S.tab = "me"; render(); window.scrollTo({ top: 0 }); };
    tb.append(tr);
  });
}

// ---------------- sheets ----------------
function closeSheet() { $("#sheet-root").innerHTML = ""; }
let sheetLocked = false;
function sheet(build, locked = false) {
  const root = $("#sheet-root"); root.innerHTML = "";
  sheetLocked = locked;
  const scrim = document.createElement("div"); scrim.className = "scrim";
  const sh = document.createElement("div"); sh.className = "sheet"; sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true");
  scrim.onclick = (ev) => { if (ev.target === scrim && !sheetLocked) closeSheet(); };
  scrim.append(sh); root.append(scrim); build(sh);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheetLocked) closeSheet(); });

// 표시 이름 입력 (required = 처음 한 번 꼭 입력)
function openName(required) {
  const doc = docOf(S.myId);
  sheet((sh) => {
    sh.append(el("h3", null, required ? "표시할 이름을 입력하세요" : "이름 바꾸기"),
      el("p", "hint", "달력과 팀 현황에서 다른 사람에게 이 이름으로 보입니다."));
    const f = field("nm-input", "이름", "text", doc.nick || "", { placeholder: "예: 김상주", maxlength: "20", autocomplete: "name" });
    sh.append(f);
    const act = el("div", "sheet-actions");
    if (!required) act.append(btn("ghost", "취소", closeSheet));
    act.append(btn("primary green", "저장", () => {
      const v = $("#nm-input").value.trim();
      if (!v) { toast("이름을 입력하세요"); $("#nm-input").focus(); return; }
      saveProfile(S.myId, { nick: v }); sheetLocked = false; closeSheet(); toast(`'${v}'(으)로 표시됩니다`);
    }));
    sh.append(act);
    setTimeout(() => { const i = $("#nm-input"); if (i) i.focus(); }, 50);
    $("#nm-input").addEventListener("keydown", (e) => { if (e.key === "Enter") act.lastChild.click(); });
  }, required);
}
function el(tag, cls, text) { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
function btn(cls, text, onclick) { const b = el("button", cls, text); b.type = "button"; b.onclick = onclick; return b; }
function field(id, label, type, value, attrs = {}) {
  const f = el("div", "field"); const l = el("label", null, label); l.htmlFor = id;
  const i = document.createElement("input"); i.id = id; i.type = type; i.value = value || "";
  Object.entries(attrs).forEach(([k, v]) => { if (v === true) i.setAttribute(k, ""); else if (v !== false) i.setAttribute(k, v); });
  f.append(l, i); return f;
}

function otPicker(container, init, onChange, disabled, label = "잔업 시간", chipsList = OT_CHIPS) {
  let val = init || 0;
  const chips = el("div", "chips"), step = el("div", "stepper"), out = el("output");
  const minus = btn(null, "−", () => { val = Math.max(0, val - 0.5); sync(); }); minus.setAttribute("aria-label", "30분 줄이기");
  const plus = btn(null, "+", () => { val = Math.min(16, val + 0.5); sync(); }); plus.setAttribute("aria-label", "30분 늘리기");
  step.append(minus, out, plus);
  const sync = () => { out.textContent = fmtH(val) + "시간"; chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.v) === val)); onChange(val); };
  chipsList.forEach((v) => { const b = btn(null, v === 0 ? "없음" : fmtH(v) + "h", () => { val = v; sync(); }); b.dataset.v = v; chips.append(b); });
  container.append(el("div", "flabel", label), chips, step);
  if (disabled) container.querySelectorAll("button").forEach((b) => (b.disabled = true));
  sync();
  return { set(v) { val = v; sync(); } };
}

function openCheckout() {
  const uid = S.myId, k = dkey(new Date()), std = stdOf(uid), nowT = hm(new Date());
  const cur = docOf(uid).days[k] || {};
  // 출근은 자동: 정규 출근 시각(오전반차는 13:00), 주말·공휴일은 특근
  const e = { ...cur, type: cur.type || (isOffDay(k) ? "holiday" : "work"), in: autoIn(cur, std) };
  const hwDay = e.type === "holiday";
  const calc = (inT, outT) => hwDay ? holidayHours(inT, outT, std) : (e.type === "pm" ? 0 : suggestOT(outT, std));
  let val = e.out ? (hwDay ? e.hw || 0 : e.ot || 0) : calc(e.in, nowT);
  sheet((sh) => {
    sh.append(el("h3", null, hwDay ? `특근 퇴근 · ${HOLIDAYS[k] || "주말"}` : "퇴근 기록"),
      el("p", "hint", hwDay ? "출근~퇴근 시간에서 점심·휴게를 빼고 30분 단위로 특근 시간을 계산했습니다." : e.type === "pm" ? "오후반차 퇴근입니다. 퇴근 시각을 확인하고 저장하세요." : `잔업은 ${std.otStart}부터 30분 단위로 계산합니다.`));
    const two = el("div", "two");
    two.append(field("co-in", "출근", "time", e.in || std.start), field("co-out", "퇴근", "time", e.out || nowT));
    sh.append(two);
    const box = el("div", "field"); const pick = otPicker(box, val, (v) => { val = v; }, false, hwDay ? "특근 시간" : "잔업 시간", hwDay ? HW_CHIPS : OT_CHIPS);
    const sug = el("div", "suggest");
    sh.append(box, sug);
    const updSug = () => {
      const s = calc($("#co-in").value, $("#co-out").value);
      sug.textContent = hwDay ? `계산된 특근: ${fmtH(s)}시간` : `${std.otStart} 이후 ${$("#co-out").value} 퇴근 → 잔업 ${fmtH(s)}시간 (30분 단위)`;
      return s;
    };
    updSug();
    ["#co-in", "#co-out"].forEach((id) => $(id).addEventListener("change", () => pick.set(updSug())));
    sh.append(field("co-note", "메모 (선택)", "text", e.note || "", { placeholder: "예: 설비 점검으로 연장" }));
    const act = el("div", "sheet-actions");
    act.append(btn("ghost", "취소", closeSheet), btn("primary", "퇴근 저장", () => {
      const base = { ...e, type: e.type || "work", in: $("#co-in").value || e.in, out: $("#co-out").value, note: $("#co-note").value.trim() };
      if (hwDay) { base.hw = val; delete base.ot; } else { base.ot = val; delete base.hw; }
      const entry = clean(base);
      saveDay(uid, k, entry); closeSheet(); toast(`퇴근 ${entry.out} · ${hwDay ? "특근" : "잔업"} ${fmtH(val)}시간 저장됨`);
    }));
    sh.append(act);
  });
}

function openDay(uid, k) {
  const e = docOf(uid).days[k] || {}, std = stdOf(uid);
  const editable = canWrite(uid);
  const [y, mo, d] = k.split("-").map(Number); const w = new Date(y, mo - 1, d).getDay();
  let type = e.type || (isOffDay(k) ? "holiday" : "work"), ot = e.ot || 0, hw = e.hw || 0;
  sheet((sh) => {
    sh.append(el("h3", null, `${mo}월 ${d}일 (${DOW[w]})${HOLIDAYS[k] ? " · " + HOLIDAYS[k] : ""}`),
      el("p", "hint", `${nameOf(uid)}${editable ? "" : " · 보기 전용"}`));
    const tl = el("div", "field"); tl.append(el("div", "flabel", "구분"));
    const tc = el("div", "chips types");
    Object.entries(TYPES).forEach(([v, l]) => {
      const b = btn(null, l, () => { type = v; tc.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); times.hidden = type === "leave"; syncKind(); });
      b.setAttribute("aria-pressed", v === type); b.disabled = !editable; tc.append(b);
    });
    tl.append(tc); sh.append(tl);
    const times = el("div", "field"); times.style.gap = "14px";
    const two = el("div", "two");
    two.append(field("dy-in", "출근", "time", e.in, { disabled: !editable }), field("dy-out", "퇴근", "time", e.out, { disabled: !editable }));
    times.append(two);
    // 잔업 / 특근 선택기 (구분에 따라 하나만 보임)
    const otBox = el("div", "field"); const otPick = otPicker(otBox, ot, (v) => { ot = v; }, !editable);
    const hwBox = el("div", "field"); const hwPick = otPicker(hwBox, hw, (v) => { hw = v; }, !editable, "특근 시간", HW_CHIPS);
    times.append(otBox, hwBox); times.hidden = type === "leave"; sh.append(times);
    const syncKind = () => { otBox.hidden = type === "holiday"; hwBox.hidden = type !== "holiday"; };
    syncKind();
    const recalc = () => {
      const i = two.querySelector("#dy-in").value, o = two.querySelector("#dy-out").value;
      if (type === "holiday") hwPick.set(holidayHours(i, o, std)); else if (o) otPick.set(type === "pm" ? 0 : suggestOT(o, std));
    };
    two.querySelectorAll("input").forEach((x) => x.addEventListener("change", recalc));
    sh.append(field("dy-note", "메모", "text", e.note, { disabled: !editable }));

    const act = el("div", "sheet-actions");
    if (editable && docOf(uid).days[k]) {
      let armed = false;
      const del = btn("danger", "기록 삭제", () => { if (!armed) { armed = true; del.textContent = "한 번 더 누르면 삭제"; return; } saveDay(uid, k, null); closeSheet(); toast("삭제했습니다"); });
      act.append(del);
    }
    act.append(btn("ghost", editable ? "취소" : "닫기", closeSheet));
    if (editable) act.append(btn("primary green", "저장", () => {
      const note = $("#dy-note").value.trim();
      const out = $("#dy-out").value;
      const entry = type === "leave" ? clean({ type, note })
        : type === "holiday" ? clean({ type, in: $("#dy-in").value, out, hw: out ? hw : 0, note })
        : clean({ type, in: $("#dy-in").value, out, ot: out ? ot : 0, note });
      saveDay(uid, k, entry); closeSheet(); toast("저장했습니다");
    }));
    sh.append(act);

    // 같은 날 다른 사람 기록 (보기 전용)
    const rows = Object.keys(S.docs).filter((ou) => ou !== uid && S.docs[ou].days[k]);
    if (rows.length) {
      sh.append(el("div", "flabel", "같은 날 다른 사람"));
      const wrap = el("div", "tbl-wrap"), t = el("table", "daylist");
      const head = el("tr"); ["이름", "구분", "출근", "퇴근", "잔업"].forEach((h) => head.append(el("th", null, h)));
      t.append(head);
      rows.forEach((ou) => {
        const oe = S.docs[ou].days[k], tr = el("tr");
        [nameOf(ou), TYPES[oe.type || "work"], oe.in || "—", oe.out || "—", oe.hw ? `특 ${fmtH(oe.hw)}h` : oe.ot ? fmtH(oe.ot) + "h" : "—"].forEach((c, i) => tr.append(el("td", i >= 2 ? "num" : null, c)));
        t.append(tr);
      });
      wrap.append(t); sh.append(wrap);
    }
  });
}

function openSettings() {
  const uid = S.myId, doc = docOf(uid), std = stdOf(uid);
  sheet((sh) => {
    sh.append(el("h3", null, "내 설정"), el("p", "hint", "잔업은 잔업 시작 시각부터 퇴근까지 30분 단위로 계산합니다. 점심 12:00~13:00 고정."));
    sh.append(field("st-nick", "표시 이름 (달력·팀 현황에 보이는 이름)", "text", doc.nick, { placeholder: "예: 김상주", maxlength: "20" }));
    const two = el("div", "two"); two.append(field("st-start", "정규 출근", "time", std.start), field("st-end", "정규 퇴근", "time", std.end)); sh.append(two);
    sh.append(field("st-ot", "잔업 시작", "time", std.otStart));
    const act = el("div", "sheet-actions");
    if (S.mode === "firebase") act.append(btn("danger", "로그아웃", () => { closeSheet(); FBX.A.signOut(FBX.auth); }));
    act.append(btn("ghost", "취소", closeSheet), btn("primary green", "저장", () => {
      const nick = $("#st-nick").value.trim();
      if (!nick) { toast("표시 이름을 입력하세요"); $("#st-nick").focus(); return; }
      saveProfile(uid, { nick, std: { start: $("#st-start").value || DEFAULT_STD.start, end: $("#st-end").value || DEFAULT_STD.end, otStart: $("#st-ot").value || DEFAULT_STD.otStart } });
      closeSheet(); toast("설정을 저장했습니다");
    }));
    sh.append(act);
  });
}

function openMembers() {
  sheet((sh) => {
    sh.append(el("h3", null, "멤버 관리"), el("p", "hint", "승인된 Google 계정만 근태를 보고 기록할 수 있습니다."));
    if (S.mode === "demo") { sh.append(el("p", "suggest", "데모 모드에서는 멤버 관리가 동작하지 않습니다. Firebase를 연결하면 사용할 수 있습니다.")); sh.append(btn("ghost", "닫기", closeSheet)); return; }
    const { F, db } = FBX, accRef = F.doc(db, "config", "access");
    if (S.requests.length) {
      sh.append(el("div", "flabel", "승인 대기"));
      const l = el("div", "list");
      S.requests.forEach((r) => {
        const it = el("div", "it"); it.append(el("span", null, `${r.name || ""} ${r.email}`));
        it.append(btn(null, "승인", async () => {
          await F.updateDoc(accRef, { members: F.arrayUnion(String(r.email).toLowerCase()) });
          // 요청할 때 입력한 이름을 표시 이름으로 미리 넣어 둠
          if (r.name) await F.setDoc(F.doc(db, "att", r.uid), { nick: r.name, email: r.email }, { merge: true }).catch(() => {});
          await F.deleteDoc(F.doc(db, "requests", r.uid)); toast(`${r.email} 승인했습니다`); openMembers();
        }));
        l.append(it);
      });
      sh.append(l);
    }
    sh.append(el("div", "flabel", "멤버"));
    const l = el("div", "list");
    const label = (m) => { const uid = Object.keys(S.docs).find((x) => (S.docs[x].email || "").toLowerCase() === m); return uid && S.docs[uid].nick ? `${S.docs[uid].nick} · ${m}` : m; };
    S.access.admins.forEach((m) => { const it = el("div", "it"); it.append(el("span", null, label(m)), el("span", "small", "관리자")); l.append(it); });
    S.access.members.filter((m) => !S.access.admins.includes(m)).forEach((m) => {
      const it = el("div", "it"); it.append(el("span", null, label(m)));
      let armed = false;
      const rm = btn(null, "제외", async () => { if (!armed) { armed = true; rm.textContent = "한 번 더"; return; } await F.updateDoc(accRef, { members: F.arrayRemove(m) }); toast("제외했습니다"); openMembers(); });
      it.append(rm); l.append(it);
    });
    sh.append(l);
    const addF = field("mb-add", "이메일로 미리 추가", "email", "", { placeholder: "name@gmail.com" }); sh.append(addF);
    const act = el("div", "sheet-actions");
    act.append(btn("ghost", "닫기", closeSheet), btn("primary green", "추가", async () => {
      const v = $("#mb-add").value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(v)) { toast("이메일 형식을 확인하세요"); return; }
      await F.updateDoc(accRef, { members: F.arrayUnion(v) }); toast(`${v} 추가했습니다`); openMembers();
    }));
    sh.append(act);
  });
}

// ---------------- helpers ----------------
function clean(o) { const r = {}; Object.entries(o).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") r[k] = v; }); return r; }
let tt; function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }

// ---------------- events ----------------
$("#tab-me").onclick = () => { S.tab = "me"; render(); };
$("#tab-team").onclick = () => { S.tab = "team"; render(); };
function shiftMonth(n) {
  S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); render();
  const g = $("#days"); g.classList.remove("slide-l", "slide-r"); void g.offsetWidth; g.classList.add(n > 0 ? "slide-l" : "slide-r");
}
$$(".prev").forEach((b) => (b.onclick = () => shiftMonth(-1)));
$$(".next").forEach((b) => (b.onclick = () => shiftMonth(1)));

// 달력 좌우 스와이프: 왼쪽으로 밀면 다음 달, 오른쪽으로 밀면 이전 달
(() => {
  const area = document.querySelector("#view-me .cal");
  let x0 = null, y0 = null, t0 = 0, swiped = false;
  area.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); swiped = false; }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) { swiped = true; shiftMonth(dx < 0 ? 1 : -1); }
  }, { passive: true });
  // 스와이프 직후 날짜가 눌려 편집창이 열리지 않도록 막음
  area.addEventListener("click", (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; } }, true);
})();
$$(".this-month").forEach((b) => (b.onclick = () => { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); render(); }));
$("#btn-settings").onclick = openSettings;
// 화면 폭이 바뀌면(가로/세로 회전) 달력 다시 그림
matchMedia("(max-width:600px)").addEventListener("change", () => render());
$("#btn-members").onclick = openMembers;

// 출근 버튼은 비활성(자동 출근). 퇴근만 누름
$("#btn-out").onclick = () => openCheckout();

// 오늘 휴가: 오전반차 / 오후반차 / 연차 (다시 누르면 취소)
let leaveArm = null;
$$("#leave-row button").forEach((b) => (b.onclick = () => {
  const uid = S.myId, k = dkey(new Date()), e = docOf(uid).days[k] || {}, t = b.dataset.type;
  if (e.type === t) { // 취소
    const rest = clean({ ...e, type: "work" });
    saveDay(uid, k, rest.in ? rest : null); toast(`${TYPES[t]} 취소했습니다`); return;
  }
  if (t === "leave" && e.in && leaveArm !== k) { leaveArm = k; toast("출근 기록이 있습니다. 연차를 한 번 더 누르면 연차로 바꿉니다"); return; }
  leaveArm = null;
  saveDay(uid, k, t === "leave" ? clean({ type: "leave", note: e.note }) : clean({ ...e, type: t }));
  toast(`오늘 ${TYPES[t]}로 기록했습니다`);
}));

function tick() { $("#clock").textContent = hm(new Date()); }
tick(); setInterval(tick, 10000);
let dayNow = dkey(new Date());
setInterval(() => { if (dkey(new Date()) !== dayNow) { dayNow = dkey(new Date()); render(); } }, 60000);
window.addEventListener("online", () => { S.stale = false; render(); });
window.addEventListener("offline", () => { S.stale = true; render(); });

// gate buttons
$("#btn-google").onclick = async () => {
  const { A, auth } = FBX; const provider = new A.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  try { await A.signInWithPopup(auth, provider); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) { await A.signInWithRedirect(auth, provider); return; }
    if (e.code === "auth/unauthorized-domain") { toast("이 주소가 Firebase 승인 도메인에 없습니다. README의 4단계를 확인하세요."); return; }
    if (e.code !== "auth/popup-closed-by-user") toast("로그인하지 못했습니다: " + e.code);
  }
};
$("#btn-gate-logout").onclick = () => FBX && FBX.A.signOut(FBX.auth);
$("#whoami").onclick = () => openName(false);
$("#gate-name").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = $("#gate-name-input").value.trim();
  if (!name) { toast("이름을 입력하세요"); return; }
  if (!FBX) { toast("데모 모드에서는 요청을 보내지 않습니다"); return; }
  const { F, db } = FBX, u = S._user;
  try {
    await F.setDoc(F.doc(db, "requests", u.uid), { email: u.email, name, at: F.serverTimestamp() });
    S.myRequest = { email: u.email, name }; showGate("pending"); toast("승인 요청을 보냈습니다");
  } catch (e) { toast("요청을 보내지 못했습니다. 잠시 후 다시 시도하세요."); }
});
$("#btn-setup").onclick = async () => {
  const { F, db } = FBX;
  try { await F.setDoc(F.doc(db, "config", "access"), { admins: [S.myEmail], members: [] }); toast("관리자로 등록했습니다"); }
  catch (e) { toast("등록하지 못했습니다. 이미 관리자가 있거나 규칙이 배포되지 않았습니다."); }
};

// 이미 홈 화면 앱으로 실행 중이면 "앱으로 사용법" 버튼 숨김
if (navigator.standalone || matchMedia("(display-mode: standalone)").matches) $("#app-guide").hidden = true;

// ---------------- boot ----------------
if (DEMO) {
  store = demoStore();
  S.myId = "demo_me"; S.viewUid = "demo_me"; S.isAdmin = true; S.myEmail = "demo@example.com";
  const screen = params.get("screen"); // 미리보기용: ?demo&screen=login|pending|setup
  if (screen) showGate(screen); else startApp();
} else {
  showGate("loading");
  firebaseBoot().catch((e) => { console.error(e); showGate("error", e.code || e.message); });
}
