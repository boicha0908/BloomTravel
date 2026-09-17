(() => {
  'use strict';

  const STORAGE_KEY = 'bloom-travel-state-v1';
  const DEMO_PHOTO = '참고자료/커플-프로필.png';
  const DEFAULT_AVATAR = '참고자료/웹사이트아이콘.png';
  const PACKING_TEMPLATE = [
    ['필수품목', ['여권', '예약확인서', '트래블카드', '신용카드', '현지 통화 지갑']],
    ['화장품', ['토너패드', '앰플', '수분크림', '선크림', '아이섀도우', '브러쉬', '아이라이너', '마스카라', '노글루 속눈썹/집게', '뷰러', '쿠션/파우더', '마스크팩', '컨실러', '블러셔']],
    ['세면도구', ['클렌징밤(소분)', '샴푸', '트리트먼트(소분)', '칫솔', '치약', '헤어캡', '손수건', '휴대용 제모기', '머리끈', '휴대용 수건', '포켓 수건']],
    ['전자기기', ['휴대폰 충전기', '삼각대', '보조배터리', '미니 손풍기', '멀티 어댑터', 'AA 건전지', '에어팟', '카메라 렌즈']],
    ['기타', ['비닐팩', '물놀이 렌즈', '렌즈통', '포켓 티슈', '포켓 물티슈', '빗', '헤어롤', '구르프', '포켓 돗자리']],
    ['비상약', ['파스', '편두통약', '진통제', '밴드', '영문 성분명 인쇄']],
    ['의류·잡화', ['백팩', '크로스백', '캐리어', '속옷', '양말(덧신)', '가디건', '상의', '하의', '원피스', '수영복', '선글라스', '크록스', '액세서리', '머리핀']]
  ];

  const FIREBASE_CONFIG = window.BLOOM_FIREBASE_CONFIG || {};
  const cloud = { app: null, auth: null, db: null, user: null, saveTimer: null, hydrated: false };
  const initFirebase = () => {
    if (!window.firebase || !FIREBASE_CONFIG.projectId) return;
    try {
      cloud.app = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(FIREBASE_CONFIG);
      cloud.auth = window.firebase.auth();
      cloud.db = window.firebase.firestore();
      cloud.auth.onAuthStateChanged(user => {
        cloud.user = user || null;
        updateAccountChrome();
        if (user) hydrateCloudState(user);
        else { cloud.hydrated = false; updateSyncPill('이 기기에 저장 중'); }
      });
    } catch (error) { console.warn('Firebase 초기화에 실패했습니다.', error); }
  };
  const updateSyncPill = text => { const node = document.querySelector('.sync-pill span'); if (node) node.textContent = text; };
  const updateAccountChrome = () => {
    const user = cloud.user;
    const avatar = document.getElementById('header-avatar');
    if (avatar && user?.photoURL) avatar.src = user.photoURL;
    const profile = document.querySelector('.header-profile');
    if (profile) profile.title = user ? `${user.displayName || user.email} 계정` : 'Google 로그인';
    updateSyncPill(user ? 'Firebase에 동기화 중' : '이 기기에 저장 중');
  };

  const id = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const today = new Date();
  const iso = date => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dateFromIso = value => new Date(`${value || iso(today)}T00:00:00`);
  const daysBetween = (start, end) => Math.max(1, Math.round((dateFromIso(end) - dateFromIso(start)) / 86400000) + 1);
  const nightsBetween = (start, end) => Math.max(0, daysBetween(start, end) - 1);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const formatDate = value => value ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' }).format(dateFromIso(value)) : '날짜 미정';
  const formatLongDate = value => value ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(dateFromIso(value)) : '날짜 미정';
  const money = (value, currency = 'KRW') => {
    const amount = Number(value || 0);
    if (currency === 'KRW') return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
    try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(amount); }
    catch { return `${currency} ${amount.toLocaleString('ko-KR')}`; }
  };
  const tripDaysLabel = trip => `${daysBetween(trip.start, trip.end)}일 · ${trip.nights || nightsBetween(trip.start, trip.end)}박`;
  const itemCount = items => items.length;

  const defaultPacking = () => PACKING_TEMPLATE.flatMap(([category, items]) => items.map(title => ({ id: id('pack'), category, title, status: 0, assignee: '공동', note: '' })));
  const defaultTrip = () => ({
    id: 'trip-bali', name: '발리 신혼여행', tagline: '우리 둘의 첫 번째 긴 여행', photo: DEMO_PHOTO,
    couple: { a: '민준', b: '서연' }, start: '2027-05-12', end: '2027-05-18', nights: 5,
    country: '인도네시아', cities: ['덴파사르', '우붓', '스미냑'], departureAirport: '인천국제공항 (ICN)', arrivalAirport: '응우라라이 국제공항 (DPS)',
    budget: { planned: 3500000, baseCurrency: 'KRW', currencies: [{ code: 'IDR', name: '인도네시아 루피아', rate: 0.086 }, { code: 'USD', name: '미국 달러', rate: 1380 }] },
    schedule: [
      { id: 's1', date: '2027-05-12', time: '10:00', title: '인천공항 출발', kind: '항공', place: '인천국제공항 제2터미널', transport: '항공기', note: '출발 3시간 전 도착하기', bookingId: 'b1' },
      { id: 's2', date: '2027-05-12', time: '18:20', title: '발리 도착 · 공항 픽업', kind: '이동', place: '응우라라이 국제공항', transport: '픽업 차량', note: '기사님 WhatsApp 확인', bookingId: 'b2' },
      { id: 's3', date: '2027-05-13', time: '09:00', title: '우붓 숲속 조식', kind: '식사', place: 'The Kayon Jungle Resort', transport: '택시', note: '예약 확정 · 2인' },
      { id: 's4', date: '2027-05-13', time: '14:00', title: '우붓 사원과 계단식 논', kind: '투어', place: 'Tegallalang Rice Terrace', transport: '투어 차량', note: '선크림과 물 챙기기' },
      { id: 's5', date: '2027-05-15', time: '16:00', title: '스미냑 체크인', kind: '숙소', place: 'Alila Seminyak', transport: '차량', note: '체크인 15:00 이후', bookingId: 'b3' },
      { id: 's6', date: '2027-05-17', time: '17:30', title: '해변 선셋 디너', kind: '식사', place: 'Seminyak Beach', transport: '도보', note: '예약번호 BLM-0717' }
    ],
    bookings: [
      { id: 'b1', type: '항공권', title: '대한항공 KE629', date: '2027-05-12', endDate: '2027-05-18', location: '인천 → 덴파사르 왕복', status: '확정', amount: 1200000, currency: 'KRW', memo: '예약번호 BLOOM7', voucher: '' },
      { id: 'b2', type: '교통', title: '공항 픽업 차량', date: '2027-05-12', endDate: '', location: '덴파사르 공항 → 우붓', status: '확정', amount: 350000, currency: 'IDR', memo: '도착 후 기사 연락', voucher: '' },
      { id: 'b3', type: '숙소', title: 'Alila Seminyak', date: '2027-05-15', endDate: '2027-05-18', location: '스미냑 해변 앞', status: '예약완료', amount: 950000, currency: 'KRW', memo: '오션뷰 · 조식 포함', voucher: '' },
      { id: 'b4', type: '투어', title: '우붓 프라이빗 투어', date: '2027-05-13', endDate: '', location: '우붓 일일 투어', status: '비교중', amount: 700000, currency: 'IDR', memo: '픽업 포함 여부 확인', voucher: '' }
    ],
    expenses: [
      { id: 'e1', date: '2027-04-02', category: '항공', merchant: '대한항공', amount: 1200000, currency: 'KRW', rate: 1, payer: '공동', split: 50, memo: '왕복 항공권' },
      { id: 'e2', date: '2027-04-15', category: '숙소', merchant: 'Alila Seminyak', amount: 950000, currency: 'KRW', rate: 1, payer: '신부', split: 50, memo: '예약금' }
    ],
    comparisons: [
      { id: 'c1', category: '숙소', vendor: 'Alila Seminyak', quote: 950000, currency: 'KRW', pros: '해변 바로 앞\n조식 포함', cons: '체크인 시간이 늦음', status: '최종 후보', picked: true },
      { id: 'c2', category: '투어', vendor: 'Ubud Day Trip', quote: 680000, currency: 'IDR', pros: '단독 차량\n일정 조정 가능', cons: '식사 불포함', status: '검토중', picked: false }
    ],
    tasks: [
      { id: 't1', title: '항공권 예약 및 여권 영문명 확인', category: '예약', done: true },
      { id: 't2', title: '숙소 예약과 체크인 시간 확인', category: '예약', done: true },
      { id: 't3', title: '여행자보험 가입', category: '서류', done: false },
      { id: 't4', title: '현지 유심 또는 eSIM 준비', category: '통신', done: false },
      { id: 't5', title: '환전·트래블카드 준비', category: '금융', done: false },
      { id: 't6', title: '공항 픽업과 투어 최종 확인', category: '예약', done: false }
    ],
    packing: defaultPacking(),
    packingCategories: PACKING_TEMPLATE.map(([category]) => category),
    contacts: [{ name: '주인도네시아 대한민국 대사관', phone: '+62 21 2967 2555', type: '긴급' }, { name: '숙소 프런트', phone: '+62 361 209 2288', type: '숙소' }],
    diary: [{ id: 'd1', date: '2027-05-12', title: '드디어 발리에 도착한 날', text: '공항을 나서는 순간부터 공기가 달랐다. 우리의 첫 여행 기록을 시작한다.' }],
    places: [{ id: 'p1', name: 'Seminyak Beach', city: '스미냑', visited: false }],
    members: [{ name: '민준 · 서연', email: 'owner@bloom.travel', role: '여행 생성자' }]
  });

  const normalizeTrip = trip => {
    const base = defaultTrip();
    const merged = { ...base, ...trip, couple: { ...base.couple, ...(trip?.couple || {}) }, budget: { ...base.budget, ...(trip?.budget || {}) } };
    ['schedule', 'bookings', 'expenses', 'comparisons', 'tasks', 'packing', 'contacts', 'diary', 'places', 'members'].forEach(key => { if (!Array.isArray(merged[key])) merged[key] = []; });
    if (!Array.isArray(merged.packingCategories)) merged.packingCategories = [...new Set([...PACKING_TEMPLATE.map(([category]) => category), ...merged.packing.map(item => item.category).filter(Boolean)])];
    merged.packingCategories = [...new Set([...merged.packingCategories.filter(Boolean), ...merged.packing.map(item => item.category).filter(Boolean)])];
    if (!merged.budget.currencies?.length) merged.budget.currencies = clone(base.budget.currencies);
    merged.nights = Number(merged.nights || nightsBetween(merged.start, merged.end));
    return merged;
  };
  const loadState = () => {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : '';
      const fallback = typeof window !== 'undefined' && String(window.name || '').startsWith(`${STORAGE_KEY}:`) ? String(window.name).slice(STORAGE_KEY.length + 1) : '';
      const saved = JSON.parse(stored || fallback || '');
      if (saved?.trips?.length) return { trips: saved.trips.map(normalizeTrip), currentTripId: saved.currentTripId || saved.trips[0].id };
    } catch (_) { /* demo fallback */ }
    const demo = defaultTrip();
    return { trips: [demo], currentTripId: demo.id };
  };
  let state = loadState();
  let activeView = 'dashboard';
  let planningTab = 'bookings';
  let selectedDate = currentTrip().start;
  let calendarCursor = dateFromIso(selectedDate);
  let bookingFilter = '전체';
  let packingFilter = '전체';
  let checklistSubtab = 'tasks';
  let packingOpen = {};
  let toastTimer;

  function currentTrip() { return state.trips.find(t => t.id === state.currentTripId) || state.trips[0]; }
  function cloudTripPayload(trip) {
    const memberIds = [...new Set([...(Array.isArray(trip.memberIds) ? trip.memberIds : []), cloud.user?.uid].filter(Boolean))];
    return { ...clone(trip), ownerUid: trip.ownerUid || cloud.user?.uid || '', memberIds, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() };
  }
  function queueCloudSave() {
    if (!cloud.user || !cloud.db) return;
    clearTimeout(cloud.saveTimer);
    cloud.saveTimer = setTimeout(async () => {
      try {
        await Promise.all(state.trips.map(trip => cloud.db.collection('trips').doc(trip.id).set(cloudTripPayload(trip), { merge: true })));
        updateSyncPill('Firebase에 저장됨');
      } catch (error) {
        console.warn('Firebase 저장에 실패했습니다.', error);
        updateSyncPill('기기에 저장 중');
      }
    }, 500);
  }
  async function hydrateCloudState(user) {
    if (!cloud.db) return;
    try {
      const snapshot = await cloud.db.collection('trips').where('memberIds', 'array-contains', user.uid).get();
      if (snapshot.empty) {
        state.trips.forEach(trip => { trip.ownerUid = user.uid; trip.memberIds = [...new Set([...(trip.memberIds || []), user.uid])]; });
        queueCloudSave();
      } else {
        const trips = snapshot.docs.map(doc => normalizeTrip({ id: doc.id, ...doc.data() }));
        state.trips = trips.length ? trips : state.trips;
        if (!state.trips.some(trip => trip.id === state.currentTripId)) state.currentTripId = state.trips[0].id;
        saveState(false);
      }
      cloud.hydrated = true;
      selectedDate = currentTrip().start;
      calendarCursor = dateFromIso(selectedDate);
      render();
      updateSyncPill('Firebase에 동기화됨');
    } catch (error) {
      console.warn('Firebase 데이터를 불러오지 못했습니다.', error);
      updateSyncPill('기기에 저장 중');
      showToast('Firebase 규칙을 확인하면 공동 저장을 사용할 수 있어요.');
    }
  }
  function saveState() {
    const serialized = JSON.stringify(state);
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, serialized); } catch (_) { /* fallback below */ }
    try { if (typeof window !== 'undefined') window.name = `${STORAGE_KEY}:${serialized}`; } catch (_) {}
    queueCloudSave();
  }
  function updateTrip(mutator) { const trip = currentTrip(); mutator(trip); saveState(); render(); }
  function showToast(message) { const node = document.getElementById('toast'); if (!node) return; node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2200); }
  function names(trip) { return `${trip.couple?.a || '신랑'} · ${trip.couple?.b || '신부'}`; }
  function dday(trip) { return Math.round((dateFromIso(trip.start) - new Date(iso(today))) / 86400000); }
  function krwValue(trip, expense) { const rate = Number(expense.rate || (expense.currency === 'KRW' ? 1 : trip.budget.currencies.find(x => x.code === expense.currency)?.rate || 1)); return Number(expense.amount || 0) * rate; }
  function budgetStats(trip) { const spent = trip.expenses.reduce((sum, expense) => sum + krwValue(trip, expense), 0); return { spent, remain: Math.max(0, Number(trip.budget.planned || 0) - spent), ratio: Math.min(100, Math.round(spent / Math.max(1, Number(trip.budget.planned || 1)) * 100)) }; }
  function taskStats(trip) { const done = trip.tasks.filter(item => item.done).length; return { done, total: trip.tasks.length, ratio: Math.round(done / Math.max(1, trip.tasks.length) * 100) }; }
  function packingStats(trip) { const packed = trip.packing.filter(item => item.status === 1).length; const purchase = trip.packing.filter(item => item.status === 2).length; return { packed, purchase, total: trip.packing.length, ratio: Math.round(packed / Math.max(1, trip.packing.length) * 100) }; }
  function packingCategoryList(trip) { return [...new Set([...(Array.isArray(trip.packingCategories) ? trip.packingCategories : []), ...trip.packing.map(item => item.category).filter(Boolean)])]; }
  function openModal(content) { const backdrop = document.getElementById('modal-backdrop'); const modal = document.getElementById('modal'); modal.innerHTML = content; backdrop.hidden = false; setTimeout(() => modal.querySelector('input,select,textarea')?.focus(), 30); }
  function closeModal() { document.getElementById('modal-backdrop').hidden = true; }
  function pageHeading(eyebrow, title, desc, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${desc}</p></div>${action}</div>`; }

  function render() {
    const trip = currentTrip();
    if (!trip) return;
    selectedDate = trip.schedule.some(item => item.date === selectedDate) || selectedDate >= trip.start && selectedDate <= trip.end ? selectedDate : trip.start;
    document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === activeView || (activeView === 'planning' && item.dataset.view === 'planning')));
    document.querySelector('.nav-group')?.classList.toggle('expanded', activeView === 'planning');
    document.querySelectorAll('.subnav button').forEach(item => item.classList.toggle('active', activeView === 'planning' && item.dataset.planningTab === planningTab));
    document.getElementById('sidebar-trip-name').textContent = trip.name;
    document.getElementById('sidebar-trip-meta').textContent = `${tripDaysLabel(trip)} · ${dday(trip) > 0 ? '준비 중' : '여행 중'}`;
    document.getElementById('sidebar-avatar').src = trip.photo || DEMO_PHOTO;
    document.getElementById('header-avatar').src = trip.photo || DEFAULT_AVATAR;
    const todayCount = trip.schedule.filter(item => item.date === iso(today)).length;
    const badge = document.getElementById('today-badge'); badge.textContent = todayCount; badge.hidden = !todayCount;
    const note = document.getElementById('sidebar-tip'); note.textContent = packingStats(trip).purchase ? `구매 예정 준비물이 ${packingStats(trip).purchase}개 있어요.` : '작은 준비가 편안한 여행을 만들어요.';
    const notificationCount = document.getElementById('notification-count'); const notifications = getNotifications(trip); notificationCount.textContent = notifications.length; notificationCount.hidden = !notifications.length;
    const main = document.getElementById('main-content');
    if (activeView === 'dashboard') { main.innerHTML = dashboardView(trip); fetchTravelServices(trip); }
    if (activeView === 'itinerary') main.innerHTML = itineraryView(trip);
    if (activeView === 'planning') main.innerHTML = planningView(trip);
    if (activeView === 'trip-mode') main.innerHTML = tripModeView(trip);
    if (activeView === 'memories') main.innerHTML = memoriesView(trip);
  }

  async function fetchTravelServices(trip) {
    const city = trip.cities?.[0] || trip.country || 'Bali';
    const weatherNode = document.getElementById('weather-service');
    const ratesNode = document.getElementById('rates-service');
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko&format=json`);
      const geo = await geoRes.json(); const place = geo.results?.[0];
      if (!place) throw new Error('도시를 찾을 수 없습니다.');
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`);
      const weather = await weatherRes.json(); const current = weather.current || {};
      const weatherCode = Number(current.weather_code);
      const weatherText = weatherCode === 0 ? '맑음' : weatherCode <= 3 ? '구름 조금' : weatherCode <= 48 ? '안개' : weatherCode <= 67 ? '비' : weatherCode <= 77 ? '눈' : '소나기';
      if (weatherNode) weatherNode.innerHTML = `<span class="service-icon">☼</span><div><small>현재 날씨 · ${escapeHtml(place.name || city)}</small><strong>${escapeHtml(weatherText)} · ${Math.round(Number(current.temperature_2m || 0))}°C</strong></div>`;
    } catch (error) {
      if (weatherNode) weatherNode.innerHTML = `<span class="service-icon">☼</span><div><small>현재 날씨</small><strong>도시를 찾지 못했어요</strong></div>`;
    }
    try {
      const codes = [...new Set((trip.budget?.currencies || []).map(rate => String(rate.code).toLowerCase()).filter(code => code && code !== 'krw'))].slice(0, 5);
      const ratesRes = await fetch(`https://api.frankfurter.dev/v2/rates?base=krw&quotes=${codes.join(',')}`);
      const rates = await ratesRes.json(); const values = rates.rates || {};
      const text = codes.length ? codes.map(code => `${code.toUpperCase()} ${Number(values[code.toUpperCase()] || values[code] || 0).toFixed(4)}`).join(' · ') : '등록된 현지 통화 없음';
      if (ratesNode) ratesNode.innerHTML = `<span class="service-icon">₩</span><div><small>KRW 기준 · Frankfurter 참고값</small><strong>${escapeHtml(text)}</strong></div>`;
    } catch (error) {
      if (ratesNode) ratesNode.innerHTML = `<span class="service-icon">₩</span><div><small>기준 환율 참고값</small><strong>잠시 후 다시 시도해 주세요</strong></div>`;
    }
  }
  function dashboardView(trip) {
    const tasks = taskStats(trip), packing = packingStats(trip), budget = budgetStats(trip);
    const upcoming = [...trip.schedule].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).filter(item => item.date >= iso(today)).slice(0, 4);
    const bars = ['예약', '예산', '짐', '일정', '기록', '공유'].map((label, index) => ({ label, value: [tasks.ratio, budget.ratio, packing.ratio, 68, trip.diary.length ? 60 : 12, trip.members.length > 1 ? 100 : 24][index] }));
    const delta = dday(trip); const dateLabel = delta > 0 ? `D-${delta}` : delta === 0 ? '오늘 출발' : `여행 ${Math.min(daysBetween(trip.start, trip.end), Math.abs(delta) + 1)}일차`;
    return `${pageHeading(`BLOOM TRAVEL · ${trip.country}`, `${escapeHtml(names(trip))}의 <span style="color:var(--lilac-deep)">여행 준비</span>`, `${escapeHtml(trip.tagline || '해야 할 일은 가볍게, 기록은 오래 남도록.')}`, `<button class="button primary" data-action="quick-add">＋ 빠른 일정 추가</button>`)}
      <div class="dashboard-grid"><section class="hero-card"><span class="eyebrow">${escapeHtml(trip.name)}</span><h2>${escapeHtml(trip.cities.join(' · '))}<br/><span style="color:var(--lilac-deep)">${escapeHtml(dateLabel)}</span></h2><p>${escapeHtml(trip.start)} → ${escapeHtml(trip.end)} · ${tripDaysLabel(trip)}</p><div class="hero-meta"><span class="meta-chip">✓ 할 일 ${tasks.done}/${tasks.total}</span><span class="meta-chip">♧ 짐 ${packing.packed}/${packing.total}</span><span class="meta-chip">₩ 예산 ${budget.ratio}% 사용</span></div><div class="hero-date"><small>여행 정보</small><strong>${trip.nights}박</strong><button data-action="edit-trip">날짜·도시 수정 ›</button></div></section><section class="progress-card"><h3>여행 준비율</h3><div class="progress-ring" style="--progress:${Math.round((tasks.ratio + packing.ratio) / 2)}%"><div class="progress-ring-content"><strong>${Math.round((tasks.ratio + packing.ratio) / 2)}%</strong><small>할 일 + 준비물</small></div></div><span class="progress-label">오늘은 작은 항목 하나만 준비해요</span></section></div>
      <div class="stat-row"><div class="stat-card"><span class="stat-icon">◷</span><small>여행까지</small><strong>${delta > 0 ? `D-${delta}` : '진행 중'}</strong></div><div class="stat-card"><span class="stat-icon">✓</span><small>할 일 완료</small><strong>${tasks.done}<small style="display:inline;font-size:11px;margin-left:3px">/${tasks.total}</small></strong></div><div class="stat-card"><span class="stat-icon">♧</span><small>준비물 챙김</small><strong>${packing.packed}<small style="display:inline;font-size:11px;margin-left:3px">/${packing.total}</small></strong></div><div class="stat-card"><span class="stat-icon">₩</span><small>남은 예산</small><strong>${money(budget.remain)}</strong></div></div>
      <div class="two-col"><section class="panel"><div class="panel-heading"><div><h3>다가오는 일정</h3><p>예약과 시간을 한눈에 확인해요.</p></div><button class="link-btn" data-view="itinerary">전체 보기 →</button></div><div class="schedule-list">${upcoming.length ? upcoming.map(scheduleRow).join('') : '<div class="empty-state">다가오는 일정이 없어요.</div>'}</div></section><section class="panel"><div class="panel-heading"><div><h3>준비 기록</h3><p>여행 준비 진행 상황</p></div><span class="tag sage">진행 중</span></div><div class="mini-chart">${bars.map(bar => `<div class="mini-bar"><i style="height:${Math.max(8, bar.value)}%"></i><small>${bar.label}</small></div>`).join('')}</div><div class="mini-legend"><span>완료율</span><span>여행 준비 흐름</span></div></section></div>
      <section class="panel travel-services" id="travel-services"><div class="panel-heading"><div><h3>여행 서비스</h3><p>날씨와 기준 환율을 자동으로 불러와요. 지도를 열어 장소를 확인할 수 있어요.</p></div><button class="button soft small" data-action="refresh-travel-services">새로고침</button></div><div class="service-grid"><article class="service-card" id="weather-service"><span class="service-icon">☼</span><div><small>현재 날씨 · ${escapeHtml(trip.cities[0] || '')}</small><strong>불러오는 중…</strong></div></article><article class="service-card" id="rates-service"><span class="service-icon">₩</span><div><small>기준 환율 참고값</small><strong>불러오는 중…</strong></div></article><article class="service-card"><span class="service-icon">⌖</span><div><small>여행 지도</small><strong>${escapeHtml(trip.cities.join(' · '))}</strong></div><button class="button ghost small" data-action="open-map">지도 열기</button></article></div></section>
      <div class="shortcut-grid"><button class="shortcut" data-action="quick-expense"><b>₩</b><span>빠른 지출</span></button><button class="shortcut" data-view="planning" data-planning-tab="checklist"><b>✓</b><span>체크리스트</span></button><button class="shortcut" data-view="trip-mode"><b>✦</b><span>오늘 여행 중</span></button><button class="shortcut" data-action="invite-partner"><b>＋</b><span>파트너 초대</span></button></div>`;
  }
  function scheduleRow(item) { return `<div class="schedule-row"><div class="schedule-date"><strong>${dateFromIso(item.date).getDate()}</strong>${new Intl.DateTimeFormat('ko-KR', { month: 'short' }).format(dateFromIso(item.date))}</div><main><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)} · ${escapeHtml(item.place || item.note || '상세 메모 없음')}</small></main><span class="tag ${item.kind === '이동' ? 'rose' : ''}">${escapeHtml(item.kind || '일정')}</span></div>`; }

  function calendarHtml(trip) {
    const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth(); const first = new Date(year, month, 1).getDay(); const days = new Date(year, month + 1, 0).getDate();
    const entryDays = new Set(trip.schedule.map(item => item.date)); let html = `<div class="calendar-head"><button data-action="prev-calendar" aria-label="이전 달">‹</button><div><strong>${year}년 ${month + 1}월</strong><small>일정이 있는 날에 표시</small></div><button data-action="next-calendar" aria-label="다음 달">›</button></div><div class="calendar-week">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-days">`;
    for (let i = 0; i < first; i += 1) html += '<span class="calendar-day blank"></span>';
    for (let day = 1; day <= days; day += 1) { const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; html += `<button class="calendar-day ${entryDays.has(date) ? 'has-entry' : ''} ${selectedDate === date ? 'selected' : ''}" data-action="select-date" data-date="${date}">${day}</button>`; }
    return `${html}</div>`;
  }
  function itineraryView(trip) {
    const dayItems = trip.schedule.filter(item => item.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)); const dayNumber = Math.max(1, daysBetween(trip.start, selectedDate)); const city = trip.cities[Math.min(trip.cities.length - 1, Math.floor((dayNumber - 1) / Math.max(1, Math.ceil(daysBetween(trip.start, trip.end) / trip.cities.length))))];
    return `${pageHeading('ITINERARY · CALENDAR + TIMELINE', '우리의 <span style="color:var(--lilac-deep)">여행 일정</span>', '달력에서 날짜를 고르면 장소와 예약을 시간순으로 정리할 수 있어요.', `<button class="button primary" data-action="add-schedule">＋ 일정 추가</button>`)}<div class="itinerary-layout"><aside><section class="calendar-card">${calendarHtml(trip)}<div class="route-card"><h4>여행 경로</h4>${trip.cities.map((cityName, index) => `<div class="route-line"><i></i><div><strong>${escapeHtml(cityName)}</strong><small>${index === 0 ? '도착 도시' : index === trip.cities.length - 1 ? '마지막 도시' : '이동 도시'}</small></div></div>`).join('')}</div></section></aside><section><div class="day-header"><div><h2>Day ${dayNumber} · ${escapeHtml(city || trip.cities[0])}</h2><p>${formatLongDate(selectedDate)} · ${dayItems.length}개 일정</p></div><button class="button soft small" data-action="edit-day-note">＋ 날짜 메모</button></div><div class="timeline">${dayItems.length ? dayItems.map(timelineItem).join('') : '<div class="panel empty-state">이 날짜에는 아직 일정이 없어요.<br/><button class="button soft small" data-action="add-schedule" style="margin-top:10px">첫 일정 추가</button></div>'}</div><div class="day-note"><label>이 날짜의 메모</label><textarea id="selected-day-note" data-day-note="${selectedDate}" placeholder="체크인 시간, 동선, 꼭 기억할 내용을 적어두세요.">${escapeHtml(trip.dayNotes?.[selectedDate] || '')}</textarea></div></section></div>`;
  }
  function timelineItem(item) { return `<article class="timeline-item"><div class="timeline-time">${escapeHtml(item.time)}</div><div class="timeline-dot"></div><div class="timeline-card"><div class="card-actions"><button data-action="edit-schedule" data-id="${item.id}" aria-label="수정">✎</button><button data-action="delete-schedule" data-id="${item.id}" aria-label="삭제">×</button></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.place || '장소 미정')} · ${escapeHtml(item.note || '메모 없음')}</p><div class="timeline-meta"><span>${escapeHtml(item.kind || '일정')}</span>${item.transport ? `<span>⌁ ${escapeHtml(item.transport)}</span>` : ''}${item.bookingId ? '<span>예약 연결됨</span>' : ''}</div></div></article>`; }

  function planningView(trip) {
    const tabs = [['bookings', '예약 관리'], ['budget', '예산·정산'], ['compare', '비교하기'], ['checklist', '체크리스트']];
    const content = planningTab === 'bookings' ? bookingsView(trip) : planningTab === 'budget' ? budgetView(trip) : planningTab === 'compare' ? compareView(trip) : checklistView(trip);
    return `${pageHeading('TRAVEL PLANNING', '여행 <span style="color:var(--lilac-deep)">플래닝</span>', '예약과 예산부터 준비물까지, 여행 전 필요한 내용을 한곳에 모았어요.') }<div class="tabs">${tabs.map(([key, label]) => `<button class="${planningTab === key ? 'active' : ''}" data-planning-tab="${key}">${label}</button>`).join('')}</div>${content}`;
  }

  function bookingsView(trip) {
    const types = ['전체', '항공권', '숙소', '교통', '투어', '보험', '유심']; const entries = trip.bookings.filter(item => bookingFilter === '전체' || item.type === bookingFilter);
    return `<div class="toolbar"><div class="booking-filter">${types.map(type => `<button class="${bookingFilter === type ? 'active' : ''}" data-booking-filter="${type}">${type}</button>`).join('')}</div><button class="button primary small" data-action="add-booking">＋ 예약 추가</button></div><div class="booking-grid">${entries.length ? entries.map(bookingCard).join('') : '<div class="panel empty-state">이 유형의 예약이 없어요.</div>'}</div>`;
  }
  function bookingCard(item) { return `<article class="booking-card"><div class="booking-card-head"><span class="tag ${item.status === '확정' || item.status === '예약완료' ? 'sage' : ''}">${escapeHtml(item.type)}</span><div class="card-actions"><button data-action="edit-booking" data-id="${item.id}">✎</button><button data-action="delete-booking" data-id="${item.id}">×</button></div></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.location || '상세 위치 미정')}</p><div class="booking-details"><div><small>일정</small><strong>${formatDate(item.date)}${item.endDate ? ` · ${formatDate(item.endDate)}` : ''}</strong></div><div><small>상태</small><strong>${escapeHtml(item.status || '확인 필요')}</strong></div><div><small>예상 금액</small><strong>${money(item.amount, item.currency)}</strong></div><div><small>메모</small><strong>${escapeHtml(item.memo || '없음')}</strong></div></div>${item.voucher ? `<a class="voucher-link" href="${escapeHtml(item.voucher)}" target="_blank" rel="noopener">${String(item.voucher).startsWith('data:') ? `▣ ${escapeHtml(item.voucherName || '오프라인 바우처')}` : '↗ 바우처 열기'}</a>` : '<span class="soft-note" style="display:block;margin-top:10px">바우처를 추가하면 오프라인 저장할 수 있어요.</span>'}</article>`; }

  function budgetView(trip) {
    const stats = budgetStats(trip); const byPayer = ['신랑', '신부', '공동'].map(payer => [payer, trip.expenses.filter(item => item.payer === payer).reduce((sum, item) => sum + krwValue(trip, item), 0)]); const groom = byPayer[0][1], bride = byPayer[1][1]; const diff = Math.round(Math.abs(groom - bride) / 2); const settlement = groom === bride ? '두 분의 개인 지출이 같아요.' : groom > bride ? `신부가 신랑에게 ${money(diff)} 보내면 균형이 맞아요.` : `신랑이 신부에게 ${money(diff)} 보내면 균형이 맞아요.`;
    return `<div class="budget-summary"><div class="budget-kpi"><small>총 예산 (KRW)</small><strong>${money(trip.budget.planned)}</strong></div><div class="budget-kpi"><small>총 사용액</small><strong>${money(stats.spent)}</strong></div><div class="budget-kpi"><small>남은 예산</small><strong>${money(stats.remain)}</strong></div><div class="budget-kpi"><small>사용률</small><strong>${stats.ratio}%</strong></div></div><div class="budget-layout"><section class="panel"><div class="panel-heading"><div><h3>빠른 지출 입력</h3><p>현지 금액과 적용 환율을 함께 기록해요.</p></div><button class="button soft small" data-action="open-currency">환율 관리</button></div>${expenseForm(trip)}<div class="panel-heading" style="margin-top:18px"><div><h3>지출 내역</h3><p>${trip.expenses.length}건 · 원화 자동 환산</p></div></div><div class="expense-list">${trip.expenses.length ? trip.expenses.slice().sort((a, b) => b.date.localeCompare(a.date)).map(expenseRow).join('') : '<div class="empty-state">아직 지출이 없어요.</div>'}</div></section><aside class="settlement"><h4>두 사람의 자동 정산</h4>${byPayer.map(([payer, amount]) => `<div class="settlement-row"><span>${payer} 결제</span><strong>${money(amount)}</strong></div>`).join('')}<div class="settlement-result">${settlement}<br/><small>공동 결제는 두 사람의 개인 부담 계산에서 제외됩니다.</small></div><div class="currency-note">여행당 여러 통화를 사용할 수 있어요. 각 지출에 적용한 환율을 저장해 당시 원화 금액을 유지합니다.</div><div class="rate-list">${trip.budget.currencies.map(rate => `<div class="rate-row"><span>${escapeHtml(rate.code)} · ${escapeHtml(rate.name)}</span><input value="${rate.rate}" data-rate-code="${rate.code}" aria-label="${rate.code} 환율" /></div>`).join('')}</div></aside></div>`;
  }
  function expenseForm(trip, item = null) { const data = item || { date: iso(today), category: '식비', merchant: '', amount: '', currency: 'KRW', rate: 1, payer: '공동', split: 50, memo: '' }; const currencies = ['KRW', ...trip.budget.currencies.map(rate => rate.code)]; return `<form id="expense-form" class="expense-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>분류</label><select name="category">${['항공', '숙소', '교통', '식비', '투어', '쇼핑', '기타'].map(x => `<option ${data.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>사용처</label><input name="merchant" value="${escapeHtml(data.merchant)}" placeholder="예: 현지 식당" required /></div><div class="field"><label>금액</label><input name="amount" type="number" min="0" value="${data.amount}" placeholder="0" required /></div><div class="field"><label>통화</label><select name="currency">${currencies.map(x => `<option ${data.currency === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>적용 환율 · 1단위당 KRW</label><input name="rate" type="number" min="0" step="0.0001" value="${data.rate || 1}" required /></div><div class="field"><label>결제자</label><select name="payer">${['공동', '신랑', '신부'].map(x => `<option ${data.payer === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>결제일</label><input name="date" type="date" value="${data.date || iso(today)}" required /></div><div class="field"><label>메모</label><input name="memo" value="${escapeHtml(data.memo)}" placeholder="영수증 위치, 팁 등" /></div><div class="form-submit"><button class="button primary small" type="submit">${item ? '지출 수정' : '지출 저장'}</button></div></form>`; }
  function expenseRow(item) { return `<div class="expense-row"><div><strong>${escapeHtml(item.category)} · ${escapeHtml(item.merchant)}</strong><small>${escapeHtml(item.date)} · ${escapeHtml(item.payer)} · ${item.currency} ${Number(item.amount).toLocaleString()} → ${money(krwValue(currentTrip(), item))}</small></div><b>${money(krwValue(currentTrip(), item))}</b><div><button data-action="edit-expense" data-id="${item.id}">수정</button><button data-action="delete-expense" data-id="${item.id}">삭제</button></div></div>`; }

  function compareView(trip) { const categories = ['전체', '항공권', '숙소', '교통', '투어', '보험', '유심']; const filter = trip._compareFilter || '전체'; const entries = trip.comparisons.filter(item => filter === '전체' || item.category === filter); return `<div class="toolbar"><div class="filter-chips">${categories.map(category => `<button class="filter-chip ${filter === category ? 'active' : ''}" data-compare-filter="${category}">${category}</button>`).join('')}</div><button class="button primary small" data-action="add-comparison">＋ 비교 항목 추가</button></div><div class="comparison-grid">${entries.length ? entries.map(comparisonCard).join('') : '<div class="panel empty-state">비교할 항목을 추가해 보세요.</div>'}</div>`; }
  function comparisonCard(item) { const pros = String(item.pros || '').split(/\n|•/).map(x => x.trim()).filter(Boolean); const cons = String(item.cons || '').split(/\n|•/).map(x => x.trim()).filter(Boolean); return `<article class="comparison-card ${item.picked ? 'is-picked' : ''}"><div class="comparison-card-head"><span class="tag">${escapeHtml(item.category)}</span>${item.picked ? '<em class="pick-badge">최종 선택</em>' : ''}<div class="card-actions"><button data-action="edit-comparison" data-id="${item.id}">✎</button><button data-action="delete-comparison" data-id="${item.id}">×</button></div></div><h4>${escapeHtml(item.vendor)}</h4><strong>${money(item.quote, item.currency)}</strong><p style="margin-top:8px">${escapeHtml(item.status || '검토중')}</p><div class="pros-cons"><div><b>장점</b>${pros.length ? `<ul>${pros.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<span>기록 없음</span>'}</div><div><b>확인할 점</b>${cons.length ? `<ul>${cons.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<span>기록 없음</span>'}</div></div><div class="comparison-footer"><span>${item.picked ? '예약으로 연결할 수 있어요.' : '검토 중'}</span><div><button data-action="toggle-pick" data-id="${item.id}">${item.picked ? '선택 해제' : '최종 선택'}</button></div></div></article>`; }

  function checklistView(trip) {
    const task = taskStats(trip), pack = packingStats(trip);
    const isPacking = checklistSubtab === 'packing';
    const tabs = `<div class="checklist-switcher" role="tablist" aria-label="체크리스트 종류"><button class="checklist-tab ${!isPacking ? 'active' : ''}" data-checklist-tab="tasks" role="tab" aria-selected="${!isPacking}">준비 할 일</button><button class="checklist-tab ${isPacking ? 'active' : ''}" data-checklist-tab="packing" role="tab" aria-selected="${isPacking}">준비물</button></div>`;
    const taskPanel = `<section class="panel checklist-single-panel"><div class="panel-heading"><div><h3>준비 할 일</h3><p>여행 전 해야 할 일을 직접 추가·수정·삭제할 수 있어요.</p></div><button class="button primary small" data-action="add-task">＋ 할 일 추가</button></div>${taskGroups(trip)}</section>`;
    const packingPanel = `<section class="panel checklist-single-panel"><div class="panel-heading"><div><h3>준비물</h3><p>한 번 누르면 챙김, 두 번 누르면 구매 예정, 세 번 누르면 빈칸으로 돌아가요.</p></div><div class="packing-actions"><button class="button soft small" data-action="open-packing-categories">분류 관리</button><button class="button primary small" data-action="add-packing">＋ 물품 추가</button></div></div><div class="toolbar"><div class="filter-chips">${['전체', '준비 전', '구매 예정', '챙김'].map(label => `<button class="filter-chip ${packingFilter === label ? 'active' : ''}" data-packing-filter="${label}">${label}</button>`).join('')}</div><button class="button ghost small" data-action="reset-packing">전체 초기화</button></div>${packingGroups(trip)}</section>`;
    return `${tabs}<div class="check-summary"><div><small>할 일 완료</small><strong>${task.done}/${task.total}</strong></div><div><small>챙긴 물품</small><strong>${pack.packed}/${pack.total}</strong></div><div><small>구매 예정</small><strong>${pack.purchase}개</strong></div></div><div class="checklist-single-view">${isPacking ? packingPanel : taskPanel}</div>`;
  }
  function taskGroups(trip) { const groups = [...new Set(trip.tasks.map(item => item.category || '기타'))]; return groups.map(group => `<section class="task-group"><div class="task-group-head"><div><strong>${escapeHtml(group)}</strong><small>${trip.tasks.filter(item => item.category === group && item.done).length}/${trip.tasks.filter(item => item.category === group).length} 완료</small></div></div><div class="check-items">${trip.tasks.filter(item => item.category === group).map(item => `<div class="check-item ${item.done ? 'done' : ''}"><button class="check-button ${item.done ? 'done' : ''}" data-action="toggle-task" data-id="${item.id}" aria-label="${item.done ? '완료 취소' : '완료 처리'}">${item.done ? '✓' : ''}</button><span class="item-title">${escapeHtml(item.title)}</span><div class="check-item-actions"><button data-action="edit-task" data-id="${item.id}">수정</button><button data-action="delete-task" data-id="${item.id}">삭제</button></div></div>`).join('')}</div></section>`).join(''); }
  function packingGroups(trip) { const categories = packingCategoryList(trip); return `<div class="packing-groups">${categories.map(category => { const items = trip.packing.filter(item => item.category === category).filter(item => packingFilter === '전체' || packingFilter === '준비 전' && item.status === 0 || packingFilter === '챙김' && item.status === 1 || packingFilter === '구매 예정' && item.status === 2); const all = trip.packing.filter(item => item.category === category); const packed = all.filter(item => item.status === 1).length; const open = packingOpen[category] !== false; return `<section class="packing-category ${open ? '' : 'collapsed'}"><div class="packing-category-head"><button data-action="toggle-packing-category" data-category="${escapeHtml(category)}">${open ? '⌄' : '›'}</button><div style="flex:1"><strong>${escapeHtml(category)}</strong><small>${packed}/${all.length} 챙김 · ${all.filter(item => item.status === 2).length} 구매 예정</small></div><button data-action="add-packing" data-category="${escapeHtml(category)}" aria-label="${escapeHtml(category)}에 물품 추가">＋</button></div><div class="packing-progress"><i style="width:${Math.round(packed / Math.max(1, all.length) * 100)}%"></i></div><div class="check-items">${items.length ? items.map(packingItem).join('') : '<div class="empty-state" style="padding:14px 4px">현재 필터에 맞는 물품이 없어요.</div>'}</div></section>`; }).join('')}</div>`; }
  function packingItem(item) { const status = Number(item.status || 0); const label = status === 1 ? '✓ 챙김' : status === 2 ? '＋ 구매 예정' : '준비 전'; return `<div class="packing-item"><button class="packing-toggle ${status === 1 ? 'packed' : status === 2 ? 'buy' : ''}" data-action="cycle-packing" data-id="${item.id}" aria-label="${escapeHtml(item.title)} 상태 변경">${label}</button><span class="item-title">${escapeHtml(item.title)}</span><small class="muted">${escapeHtml(item.assignee || '공동')}</small><div class="check-item-actions"><button data-action="edit-packing" data-id="${item.id}">수정</button><button data-action="delete-packing" data-id="${item.id}">삭제</button></div></div>`; }

  function tripModeView(trip) { const inTrip = iso(today) >= trip.start && iso(today) <= trip.end; const date = inTrip ? iso(today) : trip.start; const items = trip.schedule.filter(item => item.date === date).sort((a, b) => a.time.localeCompare(b.time)); const next = items.find(item => item.time >= new Date().toTimeString().slice(0, 5)) || items[0]; return `${pageHeading('TRAVEL MODE · OFFLINE READY', '오늘의 <span style="color:var(--lilac-deep)">여행 화면</span>', '여행 중 자주 쓰는 정보와 빠른 입력을 한 화면에 모았어요.', `<span class="tag sage">오프라인 저장 준비됨</span>`)}<div class="trip-mode-grid"><section><div class="today-hero"><span class="eyebrow">${inTrip ? 'TODAY' : 'TRIP PREVIEW'}</span><h2>${formatLongDate(date)}</h2><p>${escapeHtml(trip.cities[0])} · ${items.length}개 일정${next ? ` · 다음은 ${escapeHtml(next.title)}` : ''}</p></div><section class="panel"><div class="panel-heading"><div><h3>오늘의 타임라인</h3><p>예약과 이동 정보를 바로 확인해요.</p></div><button class="button soft small" data-action="add-schedule">＋ 일정</button></div><div class="timeline">${items.length ? items.map(timelineItem).join('') : '<div class="empty-state">오늘 일정이 없어요.</div>'}</div></section></section><aside class="info-list"><section class="info-card"><h4>빠른 기록</h4><div class="quick-actions"><button data-action="quick-expense">₩ 지출 입력</button><button data-action="add-diary">♡ 사진·메모</button><button data-action="open-currency">⇄ 환율 계산</button><button data-action="open-map">⌖ 지도 열기</button></div></section><section class="info-card"><h4>긴급 연락처</h4>${trip.contacts.map(contact => `<div class="contact-row"><div><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(contact.type)}</small></div><a class="button soft small" href="tel:${escapeHtml(contact.phone)}">전화</a></div>`).join('')}</section><section class="info-card"><h4>바우처</h4>${trip.bookings.filter(item => item.voucher || item.type === '항공권' || item.type === '숙소').map(item => `<div class="voucher-row"><strong>${escapeHtml(item.title)}</strong><span class="tag">${item.voucher ? '열기' : '정보'}</span></div>`).join('') || '<p>예약 관리에서 바우처를 추가해 보세요.</p>'}</section></aside></div>`; }

  function memoriesView(trip) { const stats = budgetStats(trip); return `${pageHeading('MEMORIES · AFTER TRIP', '우리의 <span style="color:var(--lilac-deep)">추억과 결산</span>', '여행이 끝난 뒤에도 사진과 기록, 지출을 오래 남겨두세요.', `<button class="button primary" data-action="add-diary">＋ 기록 추가</button>`)}<div class="memory-grid"><section><div class="panel-heading"><div><h3>여행 다이어리</h3><p>${trip.diary.length}개의 기록 · 날짜순</p></div></div>${trip.diary.slice().sort((a, b) => b.date.localeCompare(a.date)).map(entry => `<article class="diary-card"><div class="diary-card-head"><span class="tag">${formatDate(entry.date)}</span><div class="card-actions"><button data-action="edit-diary" data-id="${entry.id}">수정</button><button data-action="delete-diary" data-id="${entry.id}">삭제</button></div></div><h4>${escapeHtml(entry.title)}</h4><p>${escapeHtml(entry.text)}</p></article>`).join('') || '<div class="empty-state">첫 번째 여행 기록을 남겨보세요.</div>'}</section><aside><section class="panel"><div class="panel-heading"><div><h3>여행 결산</h3><p>원화 기준 자동 집계</p></div><button class="button ghost small" data-action="print-summary">인쇄·PDF</button></div><div class="budget-summary"><div class="budget-kpi"><small>총 예산</small><strong>${money(trip.budget.planned)}</strong></div><div class="budget-kpi"><small>사용액</small><strong>${money(stats.spent)}</strong></div></div><p class="soft-note">여행을 마친 뒤 지출을 모두 확인하고 정산 완료로 표시할 수 있어요.</p><button class="button primary full" data-action="archive-trip" style="margin-top:13px">이 여행을 보관함으로 이동</button></section><section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h3>방문 장소</h3><p>다시 가고 싶은 곳을 기록해요.</p></div></div>${trip.places.map(place => `<div class="contact-row"><div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.city)}</small></div><button class="button soft small" data-action="toggle-place" data-id="${place.id}">${place.visited ? '방문 완료' : '방문 예정'}</button></div>`).join('')}</section></aside></div>`; }

  function getNotifications(trip) { const notices = []; const unconfirmed = trip.bookings.filter(item => item.status !== '확정' && item.status !== '예약완료'); if (unconfirmed.length) notices.push({ title: `${unconfirmed.length}개의 예약 확인이 필요해요.`, detail: unconfirmed.map(item => item.title).join(', ') }); const purchase = packingStats(trip).purchase; if (purchase) notices.push({ title: `구매 예정 준비물 ${purchase}개`, detail: '체크리스트에서 구매 후 챙김으로 바꿔주세요.' }); return notices; }

  function openTripManager() { const trip = currentTrip(); openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">MY TRIPS</span><h2>여행 보관함</h2><p>여행을 여러 개 만들고 현재 여행을 전환할 수 있어요.</p><div class="trip-list">${state.trips.map(item => `<article class="trip-card"><div class="trip-cover">${item.photo ? `<img src="${escapeHtml(item.photo)}" alt=""/>` : ''}<span class="tag">${item.id === state.currentTripId ? '현재 여행' : '여행'}</span></div><div class="trip-card-body"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(names(item))} · ${tripDaysLabel(item)}</p><div class="trip-card-actions"><button class="button ${item.id === state.currentTripId ? 'soft' : 'primary'} small" data-action="switch-trip" data-id="${item.id}">${item.id === state.currentTripId ? '현재 여행' : '열기'}</button><button class="button ghost small" data-action="edit-trip" data-id="${item.id}">수정</button></div></div></article>`).join('')}</div><div class="modal-actions"><button class="button primary" data-action="new-trip">＋ 새 여행 만들기</button></div>`); }

  function tripForm(item = null) { const t = item || { name: '', tagline: '', couple: { a: '', b: '' }, start: iso(today), end: iso(new Date(today.getTime() + 6 * 86400000)), nights: 5, country: '', cities: [], departureAirport: '', arrivalAirport: '', budget: { planned: 0 } }; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">TRIP PROFILE</span><h2>${item ? '여행 정보 수정' : '새 여행 만들기'}</h2><p>여행의 기본 정보는 언제든 수정할 수 있어요.</p><form id="trip-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>여행 이름</label><input name="name" value="${escapeHtml(t.name)}" placeholder="예: 발리 신혼여행" required /></div><div class="field"><label>한 줄 소개</label><input name="tagline" value="${escapeHtml(t.tagline || '')}" placeholder="우리 둘의 첫 번째 긴 여행" /></div><div class="field"><label>신랑 이름</label><input name="coupleA" value="${escapeHtml(t.couple?.a || '')}" required /></div><div class="field"><label>신부 이름</label><input name="coupleB" value="${escapeHtml(t.couple?.b || '')}" required /></div><div class="field"><label>출발일</label><input name="start" type="date" value="${t.start}" required /></div><div class="field"><label>귀국일</label><input name="end" type="date" value="${t.end}" required /></div><div class="field"><label>국가</label><input name="country" value="${escapeHtml(t.country || '')}" placeholder="인도네시아" /></div><div class="field"><label>도시 (쉼표로 구분)</label><input name="cities" value="${escapeHtml((t.cities || []).join(', '))}" placeholder="덴파사르, 우붓, 스미냑" /></div><div class="field"><label>출발 공항</label><input name="departureAirport" value="${escapeHtml(t.departureAirport || '')}" /></div><div class="field"><label>도착 공항</label><input name="arrivalAirport" value="${escapeHtml(t.arrivalAirport || '')}" /></div><div class="field"><label>총 원화 예산</label><input name="planned" type="number" min="0" value="${t.budget?.planned || 0}" /></div><div class="field"><label>대표 사진</label><input name="photo" type="file" accept="image/*" /></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button><button class="button primary" type="submit">저장하기</button></div></form>`; }
  function scheduleForm(item = null) { const t = currentTrip(); const data = item || { date: selectedDate || t.start, time: '10:00', title: '', kind: '관광', place: '', transport: '', note: '', bookingId: '' }; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">ITINERARY ITEM</span><h2>${item ? '일정 수정' : '새 일정 추가'}</h2><p>시간순 일정에 장소와 이동수단, 예약 메모를 함께 남겨보세요.</p><form id="schedule-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>날짜</label><input name="date" type="date" value="${data.date}" required /></div><div class="field"><label>시간</label><input name="time" type="time" value="${data.time}" required /></div><div class="field full"><label>일정 이름</label><input name="title" value="${escapeHtml(data.title)}" placeholder="예: 우붓 사원 투어" required /></div><div class="field"><label>분류</label><select name="kind">${['항공', '숙소', '이동', '관광', '투어', '식사', '쇼핑', '기타'].map(x => `<option ${data.kind === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>이동수단</label><input name="transport" value="${escapeHtml(data.transport || '')}" placeholder="도보, 택시, 투어 차량" /></div><div class="field"><label>장소</label><input name="place" value="${escapeHtml(data.place || '')}" placeholder="주소 또는 장소명" /></div><div class="field"><label>연결 예약</label><select name="bookingId"><option value="">연결하지 않음</option>${currentTrip().bookings.map(booking => `<option value="${booking.id}" ${data.bookingId === booking.id ? 'selected' : ''}>${escapeHtml(booking.title)}</option>`).join('')}</select></div><div class="field full"><label>메모</label><textarea name="note" placeholder="예약번호, 준비물, 체크인 조건 등">${escapeHtml(data.note || '')}</textarea></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-schedule" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit">저장하기</button></div></form>`; }
  function bookingForm(item = null) { const data = item || { type: '항공권', title: '', date: selectedDate, endDate: '', location: '', status: '확인 필요', amount: '', currency: 'KRW', memo: '', voucher: '' }; const currency = ['KRW', ...currentTrip().budget.currencies.map(x => x.code)]; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">BOOKING</span><h2>${item ? '예약 수정' : '예약 추가'}</h2><p>바우처 링크는 온라인용, 파일은 이 브라우저에 저장되어 오프라인에서도 열 수 있어요.</p><form id="booking-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>예약 유형</label><select name="type">${['항공권', '숙소', '교통', '투어', '보험', '유심', '기타'].map(x => `<option ${data.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>상태</label><select name="status">${['확인 필요', '비교중', '예약완료', '확정', '취소'].map(x => `<option ${data.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field full"><label>예약명</label><input name="title" value="${escapeHtml(data.title)}" placeholder="예: 대한항공 KE629" required /></div><div class="field"><label>시작일</label><input name="date" type="date" value="${data.date}" required /></div><div class="field"><label>종료일</label><input name="endDate" type="date" value="${data.endDate || ''}" /></div><div class="field full"><label>장소·구간·주소</label><input name="location" value="${escapeHtml(data.location || '')}" placeholder="인천 → 덴파사르" /></div><div class="field"><label>금액</label><input name="amount" type="number" min="0" value="${data.amount || ''}" /></div><div class="field"><label>통화</label><select name="currency">${currency.map(x => `<option ${data.currency === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>바우처 링크 (선택)</label><input name="voucher" value="${String(data.voucher || '').startsWith('data:') ? '' : escapeHtml(data.voucher || '')}" placeholder="https://..." /></div><div class="field"><label>바우처 파일 (오프라인 저장)</label><input name="voucherFile" type="file" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" /><small class="soft-note">5MB 이하 파일을 권장합니다.</small></div><div class="field full"><label>메모</label><input name="memo" value="${escapeHtml(data.memo || '')}" placeholder="예약번호, 체크인 조건" /></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-booking" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit">저장하기</button></div></form>`; }
  function compareForm(item = null) { const data = item || { category: '숙소', vendor: '', quote: '', currency: 'KRW', pros: '', cons: '', status: '검토중' }; const currency = ['KRW', ...currentTrip().budget.currencies.map(x => x.code)]; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">COMPARE</span><h2>${item ? '비교 항목 수정' : '비교 항목 추가'}</h2><p>최종 선택한 항목은 확인 후 예약과 예산에 연결할 수 있어요.</p><form id="compare-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>분류</label><select name="category">${['항공권', '숙소', '교통', '투어', '보험', '유심', '기타'].map(x => `<option ${data.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>상태</label><select name="status">${['검토중', '최종 후보', '선택 완료', '탈락'].map(x => `<option ${data.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field full"><label>업체·상품명</label><input name="vendor" value="${escapeHtml(data.vendor)}" placeholder="예: Alila Seminyak" required /></div><div class="field"><label>견적 금액</label><input name="quote" type="number" min="0" value="${data.quote || ''}" /></div><div class="field"><label>통화</label><select name="currency">${currency.map(x => `<option ${data.currency === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field full"><label>장점</label><textarea name="pros" placeholder="한 줄에 하나씩">${escapeHtml(data.pros || '')}</textarea></div><div class="field full"><label>확인할 점</label><textarea name="cons" placeholder="한 줄에 하나씩">${escapeHtml(data.cons || '')}</textarea></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-comparison" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit" data-action="save-comparison">저장하기</button></div></form>`; }
  function taskForm(item = null) { const data = item || { title: '', category: '예약' }; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">TASK</span><h2>${item ? '할 일 수정' : '할 일 추가'}</h2><form id="task-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field full"><label>할 일</label><input name="title" value="${escapeHtml(data.title)}" placeholder="예: 여행자보험 가입" required /></div><div class="field"><label>분류</label><select name="category">${['예약', '서류', '금융', '통신', '짐', '기타'].map(x => `<option ${data.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-task" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit">저장하기</button></div></form>`; }
  function packingForm(item = null, category = '') { const data = item || { category: category || packingCategoryList(currentTrip())[0] || '필수품목', title: '', assignee: '공동', note: '' }; const categories = packingCategoryList(currentTrip()); return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">PACKING LIST</span><h2>${item ? '준비물 수정' : '준비물 추가'}</h2><form id="packing-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>카테고리</label><select name="category">${categories.map(x => `<option ${data.category === x ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></div><div class="field"><label>담당</label><select name="assignee">${['공동', '신랑', '신부'].map(x => `<option ${data.assignee === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field full"><label>물품 이름</label><input name="title" value="${escapeHtml(data.title)}" placeholder="예: 선글라스" required /></div><div class="field full"><label>메모</label><input name="note" value="${escapeHtml(data.note || '')}" placeholder="수량, 브랜드, 구매처 등" /></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-packing" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit">저장하기</button></div></form>`; }
  function packingCategoryForm(category = '') { return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">PACKING CATEGORY</span><h2>${category ? '준비물 분류 수정' : '준비물 분류 추가'}</h2><p>분류 이름을 바꾸면 해당 분류에 담긴 물품도 함께 이동해요.</p><form id="packing-category-form" class="modal-form"><input type="hidden" name="previousName" value="${escapeHtml(category)}"/><div class="field full"><label>분류 이름</label><input name="name" value="${escapeHtml(category)}" placeholder="예: 서류, 아기용품" required /></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button><button class="button primary" type="submit">${category ? '수정 저장' : '분류 추가'}</button></div></form>`; }
  function packingCategoryManager() { const trip = currentTrip(); const categories = packingCategoryList(trip); return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">PACKING CATEGORIES</span><h2>준비물 분류 관리</h2><p>분류를 추가하거나 이름을 바꾸고, 사용하지 않는 분류를 정리할 수 있어요.</p><div class="category-manager-list">${categories.map(category => { const count = trip.packing.filter(item => item.category === category).length; return `<div class="category-manager-row"><div><strong>${escapeHtml(category)}</strong><small>${count}개 물품</small></div><div class="category-manager-actions"><button class="button ghost small" data-action="edit-packing-category" data-category="${escapeHtml(category)}">수정</button><button class="button ghost small" data-action="delete-packing-category" data-category="${escapeHtml(category)}">삭제</button></div></div>`; }).join('')}</div><div class="modal-actions"><button class="button primary" data-action="add-packing-category">＋ 분류 추가</button><button class="button ghost" data-action="close-modal">닫기</button></div>`; }
  function diaryForm(item = null) { const data = item || { date: iso(today), title: '', text: '' }; return `<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">TRAVEL DIARY</span><h2>${item ? '여행 기록 수정' : '여행 기록 추가'}</h2><form id="diary-form" class="modal-form"><input type="hidden" name="id" value="${item?.id || ''}"/><div class="field"><label>날짜</label><input name="date" type="date" value="${data.date}" required /></div><div class="field"><label>제목</label><input name="title" value="${escapeHtml(data.title)}" placeholder="오늘의 한 장면" required /></div><div class="field full"><label>메모</label><textarea name="text" required placeholder="사진과 함께 남기고 싶은 이야기를 적어보세요.">${escapeHtml(data.text || '')}</textarea></div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">취소</button>${item ? '<button type="button" class="button danger" data-action="delete-diary" data-id="' + item.id + '">삭제</button>' : ''}<button class="button primary" type="submit">저장하기</button></div></form>`; }

  function accountModal() {
    const trip = currentTrip(); const user = cloud.user;
    const identity = user ? `<div class="notice-box"><strong>${escapeHtml(user.displayName || 'Google 계정')}</strong><br/><small>${escapeHtml(user.email || '')}</small></div>` : '<div class="notice-box">로그인하면 여행 데이터가 Firebase에 저장되고 다른 기기에서도 이어서 사용할 수 있어요.</div>';
    const action = user ? '<button class="button soft" data-action="firebase-logout">로그아웃</button>' : '<button class="button primary" data-action="firebase-login">Google 계정으로 로그인</button>';
    openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">ACCOUNT & SHARING</span><h2>계정과 파트너 초대</h2><p>Google 로그인 후 여행 데이터가 안전하게 동기화됩니다.</p>${identity}<div class="member-list">${trip.members.map(member => `<div class="member-row"><div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}</small></div><span class="tag">${escapeHtml(member.role)}</span></div>`).join('')}</div><form id="invite-form" class="modal-form" style="margin-top:15px"><div class="field full"><label>파트너 이메일</label><input name="email" type="email" placeholder="partner@example.com" required /></div><div class="modal-actions"><button class="button primary" type="submit">초대 링크 만들기</button></div></form><div class="modal-actions"><button class="button ghost" data-action="close-modal">닫기</button>${action}</div>`);
  }
  async function firebaseLogin() {
    if (!cloud.auth) { showToast('Firebase 설정을 먼저 확인해 주세요.'); return; }
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      await cloud.auth.signInWithPopup(provider);
      closeModal();
      showToast('Google 계정으로 로그인했어요.');
    } catch (error) {
      console.warn('Google 로그인에 실패했습니다.', error);
      showToast(error?.code === 'auth/popup-closed-by-user' ? '로그인 창을 닫았어요.' : 'Google 로그인에 실패했어요.');
    }
  }
  async function firebaseLogout() {
    if (!cloud.auth) return;
    try { await cloud.auth.signOut(); closeModal(); showToast('로그아웃했어요.'); }
    catch (_) { showToast('로그아웃에 실패했어요.'); }
  }
  async function openMapModal() {
    const city = currentTrip().cities?.[0] || currentTrip().country || 'Bali';
    if (!FIREBASE_CONFIG.mapsApiKey) { window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(city), '_blank', 'noopener'); return; }
    openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">GOOGLE MAPS</span><h2>${escapeHtml(city)} 지도</h2><p>여행 도시를 지도에서 확인할 수 있어요.</p><div id="bloom-map" style="height:360px;border-radius:16px;overflow:hidden;background:#f4efe9"></div><div id="map-status" class="soft-note" style="margin-top:9px">지도를 불러오는 중…</div>`);
    const init = async () => {
      const mapNode = document.getElementById('bloom-map'); const status = document.getElementById('map-status');
      if (!mapNode || !window.google?.maps) return;
      let center = { lat: -8.65, lng: 115.2167 };
      try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko&format=json`);
        const place = (await response.json()).results?.[0];
        if (place) center = { lat: Number(place.latitude), lng: Number(place.longitude) };
      } catch (_) { /* fallback to Bali */ }
      const map = new window.google.maps.Map(mapNode, { center, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      new window.google.maps.Marker({ map, position: center, title: city });
      if (status) status.textContent = '지도에서 장소를 확대해 확인해 보세요.';
    };
    if (window.google?.maps) { init(); return; }
    window.__bloomMapsReady = init;
    if (!document.getElementById('google-maps-script')) {
      const script = document.createElement('script'); script.id = 'google-maps-script'; script.async = true; script.defer = true; script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(FIREBASE_CONFIG.mapsApiKey)}&libraries=places&callback=__bloomMapsReady`; document.head.appendChild(script);
    }
  }
  function notificationsModal() { const notices = getNotifications(currentTrip()); openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">IN-APP NOTIFICATIONS</span><h2>여행 알림</h2><p>예약과 준비물 중 확인할 항목만 보여드려요.</p><div class="notification-list">${notices.length ? notices.map(item => `<div class="alert-row"><b>!</b><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join('') : '<div class="empty-state">새로운 알림이 없어요.</div>'}</div>`); }
  function currencyModal() { const trip = currentTrip(); openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">CURRENCY TOOL</span><h2>환율 관리</h2><p>여행에서 사용할 통화와 사용자가 정한 환율을 관리합니다.</p><form id="currency-form" class="modal-form"><div class="field"><label>통화 코드</label><input name="code" placeholder="JPY" required /></div><div class="field"><label>통화 이름</label><input name="name" placeholder="일본 엔" required /></div><div class="field"><label>1단위당 원화 환율</label><input name="rate" type="number" step="0.0001" min="0" placeholder="9.2" required /></div><div class="modal-actions"><button class="button primary" type="submit">통화 추가</button></div></form><div class="rate-list">${trip.budget.currencies.map(rate => `<div class="rate-row"><span>${escapeHtml(rate.code)} · ${escapeHtml(rate.name)}</span><strong>₩${Number(rate.rate).toLocaleString('ko-KR')}</strong></div>`).join('')}</div>`); }
  function saveComparisonForm(form) {
    if (!form) return;
    if (form.reportValidity && !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries()); const trip = currentTrip(); const existing = data.id ? trip.comparisons.find(item => item.id === data.id) : null; const status = data.status || '검토중';
    const value = { category: data.category, vendor: data.vendor, quote: Number(data.quote || 0), currency: data.currency, pros: data.pros, cons: data.cons, status, picked: status === '선택 완료' ? true : existing && existing.status === status ? Boolean(existing.picked) : false };
    if (data.id && !existing) { showToast('수정할 비교 항목을 찾지 못했어요.'); return; }
    if (existing) Object.assign(existing, value); else trip.comparisons.push({ id: id('compare'), ...value });
    saveState(); closeModal(); render(); showToast('비교 항목을 저장했어요.');
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-view],[data-action],[data-planning-tab],[data-booking-filter],[data-compare-filter],[data-packing-filter],[data-checklist-tab]');
    if (!target) return;
    if (target.dataset.view) { activeView = target.dataset.view; if (target.dataset.planningTab) planningTab = target.dataset.planningTab; if (activeView === 'planning' && target.dataset.planningTab) planningTab = target.dataset.planningTab; render(); document.getElementById('sidebar').classList.remove('open'); return; }
    if (target.dataset.planningTab) { activeView = 'planning'; planningTab = target.dataset.planningTab; render(); return; }
    if (target.dataset.bookingFilter) { bookingFilter = target.dataset.bookingFilter; render(); return; }
    if (target.dataset.compareFilter) { currentTrip()._compareFilter = target.dataset.compareFilter; saveState(); render(); return; }
    if (target.dataset.packingFilter) { packingFilter = target.dataset.packingFilter; render(); return; }
    if (target.dataset.checklistTab) { checklistSubtab = target.dataset.checklistTab; render(); return; }
    const action = target.dataset.action;
    if (action === 'toggle-sidebar') { document.getElementById('sidebar').classList.toggle('open'); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'save-comparison') { event.preventDefault(); saveComparisonForm(target.closest('form')); return; }
    if (action === 'open-trip-manager') { openTripManager(); return; }
    if (action === 'open-account') { accountModal(); return; }
    if (action === 'show-notifications') { notificationsModal(); return; }
    if (action === 'new-trip') { openModal(tripForm()); return; }
    if (action === 'switch-trip') { state.currentTripId = target.dataset.id; selectedDate = currentTrip().start; calendarCursor = dateFromIso(selectedDate); saveState(); closeModal(); render(); showToast('현재 여행을 바꿨어요.'); return; }
    if (action === 'edit-trip') { const item = target.dataset.id ? state.trips.find(x => x.id === target.dataset.id) : currentTrip(); openModal(tripForm(item)); return; }
    if (action === 'invite-partner') { accountModal(); return; }
    if (action === 'quick-add' || action === 'add-schedule') { openModal(scheduleForm()); return; }
    if (action === 'edit-schedule') { const item = currentTrip().schedule.find(x => x.id === target.dataset.id); if (item) openModal(scheduleForm(item)); return; }
    if (action === 'delete-schedule') { if (confirm('이 일정을 삭제할까요?')) { currentTrip().schedule = currentTrip().schedule.filter(x => x.id !== target.dataset.id); saveState(); closeModal(); render(); showToast('일정을 삭제했어요.'); } return; }
    if (action === 'select-date') { selectedDate = target.dataset.date; calendarCursor = dateFromIso(selectedDate); render(); return; }
    if (action === 'prev-calendar') { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); render(); return; }
    if (action === 'next-calendar') { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); render(); return; }
    if (action === 'edit-day-note') { document.getElementById('selected-day-note')?.focus(); return; }
    if (action === 'add-booking') { openModal(bookingForm()); return; }
    if (action === 'edit-booking') { const item = currentTrip().bookings.find(x => x.id === target.dataset.id); if (item) openModal(bookingForm(item)); return; }
    if (action === 'delete-booking') { if (confirm('이 예약을 삭제할까요?')) { const trip = currentTrip(); trip.bookings = trip.bookings.filter(x => x.id !== target.dataset.id); trip.schedule.forEach(item => { if (item.bookingId === target.dataset.id) item.bookingId = ''; }); saveState(); closeModal(); render(); showToast('예약을 삭제했어요.'); } return; }
    if (action === 'quick-expense') { openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">QUICK EXPENSE</span><h2>빠른 지출 입력</h2><p>여행 중에는 필요한 항목만 빠르게 적어두세요.</p>${expenseForm(currentTrip())}`); return; }
    if (action === 'edit-expense') { const item = currentTrip().expenses.find(x => x.id === target.dataset.id); if (item) openModal(`<button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">EXPENSE</span><h2>지출 수정</h2><p>환율과 결제자를 함께 확인해요.</p>${expenseForm(currentTrip(), item)}`); return; }
    if (action === 'delete-expense') { if (confirm('이 지출을 삭제할까요?')) { currentTrip().expenses = currentTrip().expenses.filter(x => x.id !== target.dataset.id); saveState(); render(); showToast('지출을 삭제했어요.'); } return; }
    if (action === 'open-currency') { currencyModal(); return; }
    if (action === 'add-comparison') { openModal(compareForm()); return; }
    if (action === 'edit-comparison') { const item = currentTrip().comparisons.find(x => x.id === target.dataset.id); if (item) openModal(compareForm(item)); return; }
    if (action === 'delete-comparison') { if (confirm('이 비교 항목을 삭제할까요?')) { currentTrip().comparisons = currentTrip().comparisons.filter(x => x.id !== target.dataset.id); saveState(); closeModal(); render(); showToast('비교 항목을 삭제했어요.'); } return; }
    if (action === 'toggle-pick') { const item = currentTrip().comparisons.find(x => x.id === target.dataset.id); if (item) { item.picked = !item.picked; item.status = item.picked ? '선택 완료' : '검토중'; saveState(); render(); showToast(item.picked ? '최종 선택으로 표시했어요.' : '최종 선택을 해제했어요.'); } return; }
    if (action === 'add-task') { openModal(taskForm()); return; }
    if (action === 'edit-task') { const item = currentTrip().tasks.find(x => x.id === target.dataset.id); if (item) openModal(taskForm(item)); return; }
    if (action === 'delete-task') { if (confirm('이 할 일을 삭제할까요?')) { currentTrip().tasks = currentTrip().tasks.filter(x => x.id !== target.dataset.id); saveState(); closeModal(); render(); showToast('할 일을 삭제했어요.'); } return; }
    if (action === 'toggle-task') { const item = currentTrip().tasks.find(x => x.id === target.dataset.id); if (item) { item.done = !item.done; saveState(); render(); } return; }
    if (action === 'add-packing') { openModal(packingForm(null, target.dataset.category || '')); return; }
    if (action === 'open-packing-categories') { openModal(packingCategoryManager()); return; }
    if (action === 'add-packing-category') { openModal(packingCategoryForm()); return; }
    if (action === 'edit-packing-category') { openModal(packingCategoryForm(target.dataset.category || '')); return; }
    if (action === 'delete-packing-category') {
      const trip = currentTrip(); const category = target.dataset.category; const categories = packingCategoryList(trip); const fallback = categories.find(item => item !== category);
      if (!category || !categories.includes(category)) return;
      if (!fallback) { showToast('분류는 하나 이상 남겨야 해요.'); return; }
      const count = trip.packing.filter(item => item.category === category).length;
      const message = count ? `“${category}”의 물품 ${count}개를 “${fallback}”으로 이동하고 분류를 삭제할까요?` : `“${category}” 분류를 삭제할까요?`;
      if (confirm(message)) { trip.packing.forEach(item => { if (item.category === category) item.category = fallback; }); trip.packingCategories = categories.filter(item => item !== category); saveState(); openModal(packingCategoryManager()); showToast('준비물 분류를 삭제했어요.'); }
      return;
    }
    if (action === 'edit-packing') { const item = currentTrip().packing.find(x => x.id === target.dataset.id); if (item) openModal(packingForm(item)); return; }
    if (action === 'delete-packing') { if (confirm('이 준비물을 삭제할까요?')) { currentTrip().packing = currentTrip().packing.filter(x => x.id !== target.dataset.id); saveState(); closeModal(); render(); showToast('준비물을 삭제했어요.'); } return; }
    if (action === 'cycle-packing') { const item = currentTrip().packing.find(x => x.id === target.dataset.id); if (item) { item.status = (Number(item.status || 0) + 1) % 3; saveState(); render(); } return; }
    if (action === 'toggle-packing-category') { const category = target.dataset.category; packingOpen[category] = packingOpen[category] === false; render(); return; }
    if (action === 'reset-packing') { if (confirm('모든 준비물 상태를 빈칸으로 초기화할까요?')) { currentTrip().packing.forEach(item => item.status = 0); saveState(); render(); showToast('준비물 상태를 초기화했어요.'); } return; }
    if (action === 'add-diary') { openModal(diaryForm()); return; }
    if (action === 'edit-diary') { const item = currentTrip().diary.find(x => x.id === target.dataset.id); if (item) openModal(diaryForm(item)); return; }
    if (action === 'delete-diary') { if (confirm('이 기록을 삭제할까요?')) { currentTrip().diary = currentTrip().diary.filter(x => x.id !== target.dataset.id); saveState(); closeModal(); render(); showToast('기록을 삭제했어요.'); } return; }
    if (action === 'toggle-place') { const item = currentTrip().places.find(x => x.id === target.dataset.id); if (item) { item.visited = !item.visited; saveState(); render(); } return; }
    if (action === 'archive-trip') { showToast('여행 보관함 기능은 다음 업데이트에서 연결됩니다.'); return; }
    if (action === 'open-map') { openMapModal(); return; }
    if (action === 'print-summary') { window.print(); return; }
    if (action === 'firebase-login') { firebaseLogin(); return; }
    if (action === 'firebase-logout') { firebaseLogout(); return; }
    if (action === 'refresh-travel-services') { fetchTravelServices(currentTrip()); showToast('날씨와 환율을 새로 조회했어요.'); return; }
  });

  document.addEventListener('input', event => { if (event.target.matches('[data-day-note]')) { const trip = currentTrip(); trip.dayNotes = trip.dayNotes || {}; trip.dayNotes[event.target.dataset.dayNote] = event.target.value; saveState(); } });
  document.addEventListener('change', event => { if (event.target.dataset.rateCode) { const rate = currentTrip().budget.currencies.find(x => x.code === event.target.dataset.rateCode); if (rate) { rate.rate = Number(event.target.value || 0); saveState(); render(); showToast(`${rate.code} 환율을 저장했어요.`); } } });

  document.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form).entries()); const trip = currentTrip();
    if (form.id === 'trip-form') {
      let photo = trip.photo; const file = form.photo.files?.[0]; if (file) photo = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
      const item = form.id && data.id ? state.trips.find(x => x.id === data.id) : null; const target = item || normalizeTrip({ id: id('trip'), name: data.name, tagline: data.tagline, photo, couple: { a: data.coupleA, b: data.coupleB }, start: data.start, end: data.end, nights: nightsBetween(data.start, data.end), country: data.country, cities: data.cities.split(',').map(x => x.trim()).filter(Boolean), departureAirport: data.departureAirport, arrivalAirport: data.arrivalAirport, budget: { planned: Number(data.planned || 0), baseCurrency: 'KRW', currencies: clone(trip.budget.currencies) } });
      Object.assign(target, { name: data.name, tagline: data.tagline, photo, couple: { a: data.coupleA, b: data.coupleB }, start: data.start, end: data.end, nights: nightsBetween(data.start, data.end), country: data.country, cities: data.cities.split(',').map(x => x.trim()).filter(Boolean), departureAirport: data.departureAirport, arrivalAirport: data.arrivalAirport }); target.budget.planned = Number(data.planned || 0); if (!item) { state.trips.push(target); state.currentTripId = target.id; selectedDate = target.start; calendarCursor = dateFromIso(selectedDate); } saveState(); closeModal(); render(); showToast(item ? '여행 정보를 수정했어요.' : '새 여행을 만들었어요.'); return;
    }
    if (form.id === 'schedule-form') { const value = { date: data.date, time: data.time, title: data.title, kind: data.kind, place: data.place, transport: data.transport, note: data.note, bookingId: data.bookingId }; if (data.id) Object.assign(trip.schedule.find(x => x.id === data.id), value); else trip.schedule.push({ id: id('schedule'), ...value }); selectedDate = data.date; calendarCursor = dateFromIso(data.date); saveState(); closeModal(); render(); showToast('일정을 저장했어요.'); return; }
    if (form.id === 'booking-form') {
      let voucher = data.voucher || ''; let voucherName = '';
      const file = form.voucherFile?.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) { showToast('바우처 파일은 5MB 이하로 선택해 주세요.'); return; }
        voucherName = file.name;
        voucher = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
      }
      const value = { type: data.type, status: data.status, title: data.title, date: data.date, endDate: data.endDate, location: data.location, amount: Number(data.amount || 0), currency: data.currency, memo: data.memo, voucher, voucherName };
      if (data.id) Object.assign(trip.bookings.find(x => x.id === data.id), value); else trip.bookings.push({ id: id('booking'), ...value });
      saveState(); closeModal(); render(); showToast(file ? '예약과 오프라인 바우처를 저장했어요.' : '예약을 저장했어요.'); return;
    }
    if (form.id === 'expense-form') { const value = { category: data.category, merchant: data.merchant, date: data.date, amount: Number(data.amount || 0), currency: data.currency, rate: Number(data.rate || 1), payer: data.payer, split: 50, memo: data.memo }; if (data.id) Object.assign(trip.expenses.find(x => x.id === data.id), value); else trip.expenses.push({ id: id('expense'), ...value }); saveState(); closeModal(); render(); showToast('지출을 저장했어요.'); return; }
    if (form.id === 'compare-form') { saveComparisonForm(form); return; }
    if (form.id === 'task-form') { const value = { title: data.title, category: data.category, done: false }; if (data.id) Object.assign(trip.tasks.find(x => x.id === data.id), value); else trip.tasks.push({ id: id('task'), ...value }); saveState(); closeModal(); render(); showToast('할 일을 저장했어요.'); return; }
    if (form.id === 'packing-form') { const value = { category: data.category, title: data.title, assignee: data.assignee, note: data.note }; if (data.id) Object.assign(trip.packing.find(x => x.id === data.id), value); else trip.packing.push({ id: id('pack'), ...value, status: 0 }); saveState(); closeModal(); render(); showToast('준비물을 저장했어요.'); return; }
    if (form.id === 'packing-category-form') {
      const name = String(data.name || '').trim(); const previous = String(data.previousName || '').trim(); const categories = packingCategoryList(trip);
      if (!name) { showToast('분류 이름을 입력해 주세요.'); return; }
      if (categories.includes(name) && name !== previous) { showToast('이미 있는 분류 이름이에요.'); return; }
      if (previous) { trip.packingCategories = categories.map(category => category === previous ? name : category); trip.packing.forEach(item => { if (item.category === previous) item.category = name; }); }
      else trip.packingCategories = [...categories, name];
      saveState(); closeModal(); render(); showToast(previous ? '준비물 분류를 수정했어요.' : '준비물 분류를 추가했어요.'); return;
    }
    if (form.id === 'diary-form') { const value = { date: data.date, title: data.title, text: data.text }; if (data.id) Object.assign(trip.diary.find(x => x.id === data.id), value); else trip.diary.push({ id: id('diary'), ...value }); saveState(); closeModal(); render(); showToast('여행 기록을 저장했어요.'); return; }
    if (form.id === 'invite-form') { const email = data.email; trip.members.push({ name: email.split('@')[0], email, role: '초대 대기' }); saveState(); closeModal(); render(); showToast('파트너 초대 링크를 만들었어요.'); return; }
    if (form.id === 'currency-form') { const code = data.code.toUpperCase(); if (!trip.budget.currencies.some(x => x.code === code)) trip.budget.currencies.push({ code, name: data.name, rate: Number(data.rate || 0) }); saveState(); closeModal(); render(); showToast(`${code} 통화를 추가했어요.`); return; }
  });

  document.getElementById('modal-backdrop').addEventListener('click', event => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  initFirebase();
  render();
})();
