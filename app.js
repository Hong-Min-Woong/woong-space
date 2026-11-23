/* 웅 Space — 공개 콘텐츠와 관리자 UI. 데이터 권한은 Supabase RLS가 결정합니다. */
(() => {
  'use strict';

  const CONFIG = window.WS || {};
  const KAKAO_CHAT = 'https://pf.kakao.com/_fmxoxeX/chat';
  const ids = id => document.getElementById(id);
  const state = {
    db: null, user: null, profile: null, admin: false, authVersion: 0,
    site: {}, cases: [], notices: [], reviews: [], editCase: null,
    editNotice: null, removedImages: new Set(), activeTab: 'about',
    adminReturnFocus: null, adminOverflow: '', failures: new Map(),
    aboutDefaults: {}, historyDefaults: [], siteReady: false, siteLoadPromise: null,
    authResolved: false, adminOpenedByHash: false,
    route: 'home', homeCaseIndex: 0, homeCaseTimer: null, homeCasePaused: false
  };
  const tabPanes = { about: 'adminAbout', cases: 'adminCases', notices: 'adminNotices', reviews: 'adminReviews' };
  const routeTitles = { home: '웅 Space | 우리 동네 믿을 수 있는 턴키 인테리어', gallery: '시공사례 | 웅 Space', about: '회사소개 | 웅 Space', reviews: '고객후기 | 웅 Space', trend: '인테리어 트렌드 | 웅 Space', notice: '공지사항 | 웅 Space' };
  const aboutKeys = ['intro', 'greeting', 'philosophy', 'vision'];
  const aboutIds = { intro: 'aboutIntro', greeting: 'aboutGreeting', philosophy: 'aboutPhilosophy', vision: 'aboutVision' };

  const str = value => value == null ? '' : String(value);
  const dateText = value => str(value).slice(0, 10);
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);
  const imagesOf = item => Array.isArray(item && item.images) ? item.images.filter(p => typeof p === 'string' && p.trim()) : [];
  const field = (form, name) => form && form.elements ? form.elements.namedItem(name) : null;
  const val = (form, name) => str(field(form, name)?.value).trim();
  const setVal = (form, name, value) => { const input = field(form, name); if (input) input.value = str(value); };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const button = (label, action, id) => {
    const b = el('button', 'sb', label);
    b.type = 'button';
    b.dataset.action = action;
    if (id != null) b.dataset.id = String(id);
    return b;
  };
  const replace = (id, ...children) => { const node = ids(id); if (node) node.replaceChildren(...children); };
  const message = (id, text, error = false) => {
    const node = ids(id);
    if (!node) return;
    node.textContent = text || '';
    node.setAttribute('role', error ? 'alert' : 'status');
    node.setAttribute('aria-live', error ? 'assertive' : 'polite');
  };
  const detail = error => str(error && error.message || error || '알 수 없는 오류');
  const errorText = (label, error) => `${label}: ${detail(error)}`;
  function connection(key, error) {
    if (error) state.failures.set(key, detail(error));
    else state.failures.delete(key);
    const node = ids('connectionStatus');
    if (!node) return;
    const entries = [...state.failures.entries()];
    message('connectionStatus', entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(' · ') : '서비스에 연결되었습니다.', entries.length > 0);
  }
  function requireDB() {
    if (!state.db) throw new Error('Supabase 설정 또는 연결을 확인해 주세요.');
    return state.db;
  }
  function requireAdmin() {
    requireDB();
    if (!state.user || !state.admin) throw new Error('관리자 권한을 확인할 수 없습니다. 다시 로그인해 주세요.');
  }
  function checked(result) {
    if (!result) throw new Error('서버 응답이 없습니다.');
    if (result.error) throw result.error;
    return result.data;
  }
  function checkedRows(result) {
    const rows = checked(result);
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('변경된 항목이 없습니다. 권한 또는 항목 상태를 확인해 주세요.');
    return rows;
  }
  function on(id, event, handler) {
    const node = ids(id);
    if (node) node.addEventListener(event, handler);
  }
  function asyncOn(id, event, handler, errorId) {
    on(id, event, ev => {
      // Run the handler synchronously until its first await, so preventDefault
      // takes effect before the browser performs the form's default action.
      try { Promise.resolve(handler(ev)).catch(error => {
        message(errorId || 'connectionStatus', errorText('오류', error), true);
      }); } catch (error) { message(errorId || 'connectionStatus', errorText('오류', error), true); }
    });
  }
  function appendText(parent, tag, className, text) {
    const node = el(tag, className, text);
    parent.append(node);
    return node;
  }
  function setBusy(node, busy) {
    if (!node) return;
    node.disabled = busy;
    node.setAttribute('aria-busy', String(busy));
  }
  function publicImage(path) {
    if (!state.db || typeof path !== 'string' || !path.trim()) return '';
    // Stored values are object paths, never arbitrary external URLs.
    if (/^(?:[a-z]+:|\/\/)/i.test(path)) return '';
    try {
      const url = state.db.storage.from('cases').getPublicUrl(path).data?.publicUrl;
      const parsed = new URL(url);
      return /^(https?:)$/.test(parsed.protocol) ? parsed.href : '';
    } catch (_) { return ''; }
  }
  function createImage(path, alt, className) {
    const src = publicImage(path);
    if (!src) return null;
    const image = el('img', className || '');
    image.src = src;
    image.alt = alt || '';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    return image;
  }
  function addParagraph(parent, text, className) {
    const p = appendText(parent, 'p', className || '', text);
    p.style.whiteSpace = 'pre-line';
    return p;
  }
  function ratingOf(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 5;
  }
  function stars(value) {
    const n = ratingOf(value);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  function setStatusPlaceholder(id, text) {
    replace(id, el('p', 'empty sub', text));
  }
  function listRow(listId, chunks) {
    const list = ids(listId);
    if (!list) return null;
    const tag = list.tagName.toLowerCase();
    if (tag === 'tbody' || tag === 'thead' || tag === 'table') {
      const row = el('tr');
      for (const chunk of chunks) {
        const cell = el('td');
        if (chunk instanceof Node) cell.append(chunk); else cell.textContent = str(chunk);
        row.append(cell);
      }
      return row;
    }
    const row = el(tag === 'ul' || tag === 'ol' ? 'li' : 'div', 'admin-list-item');
    for (const chunk of chunks) {
      const part = el('div');
      if (chunk instanceof Node) part.append(chunk); else part.textContent = str(chunk);
      row.append(part);
    }
    return row;
  }
  function listEmpty(listId, text) {
    const row = listRow(listId, [text]);
    if (row) replace(listId, row);
  }

  /* Dialogs use the native top layer and return focus to their invoker. */
  const dialogInvokers = new WeakMap();
  function openDialog(dialog, focusTarget) {
    if (!dialog || dialog.open) return;
    dialogInvokers.set(dialog, document.activeElement);
    dialog.setAttribute('aria-modal', 'true');
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); }
      (focusTarget || dialog.querySelector('button, [href], input, select, textarea, [tabindex="0"]'))?.focus();
    } catch (error) { message('connectionStatus', errorText('창을 열 수 없습니다', error), true); }
  }
  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else { dialog.removeAttribute('open'); restoreDialogFocus(dialog); }
  }
  function restoreDialogFocus(dialog) {
    const previous = dialogInvokers.get(dialog);
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    dialogInvokers.delete(dialog);
  }
  function bindDialog(dialog) {
    if (!dialog) return;
    dialog.addEventListener('close', () => restoreDialogFocus(dialog));
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && typeof dialog.close !== 'function') {
        event.preventDefault(); closeDialog(dialog); return;
      }
      // Native dialogs trap focus themselves; this also supports the fallback.
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(item => !item.hidden && item.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
  }

  /* Public data. Keep the HTML's brand copy when the DB contains setup instructions. */
  function isSetupInstruction(value) {
    const text = str(value).trim();
    if (!text) return true;
    if (text.length > 120 || /\n/.test(text)) return false;
    const action = /(?:입력|작성|등록|설정)(?:해\s*주세요|해주세요|하세요|하십시오|해\s*주시기\s*바랍니다)[.!]?$/;
    return action.test(text) && /(?:관리자|회사\s*소개|대표\s*인사말|인사말|운영\s*철학|철학|비전|연혁)/.test(text);
  }
  function captureAboutDefaults() {
    for (const key of aboutKeys) state.aboutDefaults[key] = ids(aboutIds[key])?.textContent || '';
    state.historyDefaults = [...(ids('aboutHistory')?.childNodes || [])].map(node => node.cloneNode(true));
  }
  function drawAbout() {
    for (const key of aboutKeys) {
      const node = ids(aboutIds[key]);
      if (!node) continue;
      const text = str(state.site[key]?.text);
      node.textContent = isSetupInstruction(text) ? (state.aboutDefaults[key] || '등록된 내용이 없습니다.') : text;
      node.style.whiteSpace = 'pre-line';
    }
    const history = Array.isArray(state.site.history?.items) ? state.site.history.items : [];
    const entries = history.filter(item => item && !isSetupInstruction(item.text)).map(item => {
      const row = el('div', 'history-item');
      appendText(row, 'strong', '', str(item?.year));
      appendText(row, 'span', '', ` ${str(item?.text)}`);
      return row;
    });
    const defaults = state.historyDefaults.map(node => node.cloneNode(true));
    replace('aboutHistory', ...(entries.length ? entries : defaults.length ? defaults : [el('p', 'sub', '등록된 연혁이 없습니다.')]));
  }
  function aboutSubmit() {
    return ids('aboutForm')?.querySelector('[type="submit"], button:not([type])') || null;
  }
  async function fetchSite() {
    try {
      const rows = checked(await requireDB().from('site_content').select('key,value')) || [];
      state.site = Object.fromEntries(rows.map(row => [row.key, row.value]));
      state.siteReady = true;
      drawAbout(); connection('회사소개', null);
      if (state.admin && ids('adminRoot') && !ids('adminRoot').hidden) {
        fillAboutForm(); message('aboutMsg', '회사소개를 불러왔습니다.');
      }
      setBusy(aboutSubmit(), false);
      return true;
    } catch (error) {
      state.siteReady = false;
      setBusy(aboutSubmit(), true);
      for (const id of Object.values(aboutIds)) message(id, '회사소개를 불러오지 못했습니다.', true);
      message('aboutHistory', '연혁을 불러오지 못했습니다.', true);
      message('aboutMsg', errorText('회사소개 조회 실패. 관리자 화면을 닫고 다시 열어 재시도해 주세요', error), true);
      connection('회사소개', error); return false;
    }
  }
  function loadSite() {
    if (state.siteLoadPromise) return state.siteLoadPromise;
    state.siteReady = false; setBusy(aboutSubmit(), true);
    state.siteLoadPromise = fetchSite().finally(() => { state.siteLoadPromise = null; });
    return state.siteLoadPromise;
  }
  function caseCard(item) {
    const card = el('article', 'case-card-wrap');
    const b = el('button', 'case-card case-card__button');
    b.type = 'button'; b.dataset.caseId = str(item.id);
    b.setAttribute('aria-label', `${str(item.title) || '시공사례'} 자세히 보기`);
    const image = createImage(item.cover_path || imagesOf(item)[0], str(item.title), 'case-image case-card__image');
    if (image) b.append(image);
    else appendText(b, 'div', 'case-image case-placeholder', '이미지 준비 중');
    const body = el('div', 'case-card__body b');
    appendText(body, 'span', 'case-card__category tag', str(item.category));
    const heading = appendText(body, 'h3', 'case-title', str(item.title) || '제목 없는 시공사례');
    const arrow = appendText(heading, 'span', 'case-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true');
    appendText(body, 'p', 'case-meta', [item.region, item.area, item.period].filter(Boolean).join(' · '));
    b.append(body); card.append(b); return card;
  }
  function drawCases() {
    const rows = state.cases.slice(0, 6);
    replace('casesGrid', ...rows.map(caseCard));
    drawHomeCases();
    message('casesStatus', rows.length ? '' : '등록된 시공사례가 없습니다.');
    if (state.admin) drawCaseList();
  }

  function setHomeCaseIndex(index) {
    const slides = [...(ids('homeCaseSlides')?.querySelectorAll('.home-case-slide') || [])];
    if (!slides.length) return;
    state.homeCaseIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => { slide.hidden = position !== state.homeCaseIndex; });
    ids('homeCaseDots')?.querySelectorAll('button[data-slide-index]').forEach(dot => {
      const current = Number(dot.dataset.slideIndex) === state.homeCaseIndex;
      dot.setAttribute('aria-current', String(current));
      dot.setAttribute('aria-pressed', String(current));
    });
  }
  function stopHomeCaseAutoplay() {
    if (state.homeCaseTimer) window.clearInterval(state.homeCaseTimer);
    state.homeCaseTimer = null;
  }
  function syncHomeCaseAutoplay() {
    stopHomeCaseAutoplay();
    const count = ids('homeCaseSlides')?.querySelectorAll('.home-case-slide').length || 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (state.route === 'home' && !state.homeCasePaused && count > 1 && !reducedMotion) {
      state.homeCaseTimer = window.setInterval(() => setHomeCaseIndex(state.homeCaseIndex + 1), 6000);
    }
  }
  function drawHomeCases() {
    const rows = state.cases.slice(0, 4);
    const slides = rows.map((item, index) => {
      const title = str(item.title) || '시공사례';
      const slide = el('button', 'home-case-slide');
      slide.type = 'button'; slide.dataset.caseId = str(item.id);
      slide.setAttribute('aria-label', `${title} 시공사례 자세히 보기`);
      const image = createImage(item.cover_path || imagesOf(item)[0], title, 'home-case-image');
      if (image) slide.append(image); else appendText(slide, 'span', 'home-case-image-placeholder', 'WOONG SPACE');
      const shade = el('span', 'home-case-shade'); shade.setAttribute('aria-hidden', 'true');
      const copy = el('span', 'home-case-copy');
      appendText(copy, 'span', 'home-case-tag', [item.category, item.region].filter(Boolean).join(' · ') || 'WOONG SPACE PROJECT');
      appendText(copy, 'span', 'home-case-title', title);
      appendText(copy, 'span', 'home-case-meta', [item.area, item.period].filter(Boolean).join(' · ') || '웅 Space 시공사례');
      appendText(copy, 'span', 'home-case-open', '사례 자세히 보기  ↗');
      slide.append(shade, copy); slide.hidden = index !== state.homeCaseIndex;
      return slide;
    });
    if (slides.length) replace('homeCaseSlides', ...slides);
    else replace('homeCaseSlides', el('p', 'empty', '등록된 시공사례가 없습니다.'));
    const dots = rows.map((item, index) => {
      const dot = el('button', 'carousel-dot', String(index + 1));
      dot.type = 'button'; dot.dataset.slideIndex = String(index);
      dot.setAttribute('aria-label', `${index + 1}번 시공사례: ${str(item.title) || '시공사례'}`);
      dot.setAttribute('aria-current', String(index === state.homeCaseIndex));
      dot.setAttribute('aria-pressed', String(index === state.homeCaseIndex));
      return dot;
    });
    replace('homeCaseDots', ...dots);
    const controls = ids('homeCaseControls'); if (controls) controls.hidden = rows.length < 2;
    setHomeCaseIndex(state.homeCaseIndex);
    const toggle = ids('homeCaseToggle');
    if (toggle) { toggle.textContent = state.homeCasePaused ? '자동 넘김 시작' : '자동 넘김 멈춤'; toggle.setAttribute('aria-pressed', String(state.homeCasePaused)); }
    syncHomeCaseAutoplay();
  }
  async function loadCases() {
    message('casesStatus', '시공사례를 불러오는 중입니다.');
    try {
      const rows = checked(await requireDB().from('cases').select('*').order('created_at', { ascending: false })) || [];
      state.cases = rows; drawCases(); connection('시공사례', null); return true;
    } catch (error) {
      replace('casesGrid'); message('casesStatus', errorText('시공사례를 불러오지 못했습니다', error), true);
      if (state.admin) listEmpty('caseList', '시공사례 목록을 불러오지 못했습니다.');
      connection('시공사례', error); return false;
    }
  }
  function openCase(id) {
    const item = state.cases.find(row => sameId(row.id, id));
    const dialog = ids('caseDialog');
    const content = ids('caseDialogContent');
    if (!item || !dialog || !content) return;
    const close = button('×', 'close-case'); close.className = 'dialog-close case-dialog__close'; close.setAttribute('aria-label', '시공사례 닫기');
    const title = el('h2', 'dialog-title case-dialog__title', str(item.title) || '시공사례');
    title.id = 'caseDialogTitle'; dialog.setAttribute('aria-labelledby', title.id);
    const meta = el('p', 'dialog-meta case-dialog__meta', [item.category, item.region, item.area, item.period].filter(Boolean).join(' · '));
    const children = [close, title, meta];
    const paths = [...new Set([item.cover_path, ...imagesOf(item)].filter(Boolean))];
    const pictures = paths.map((path, index) => createImage(path, `${str(item.title) || '시공사례'} 이미지 ${index + 1}`, 'dialog-image case-dialog__image')).filter(Boolean);
    if (pictures.length) children.push(...pictures);
    else children.push(el('p', 'sub', '등록된 이미지가 없습니다.'));
    const description = el('p', 'dialog-body case-dialog__description', str(item.description));
    description.style.whiteSpace = 'pre-line'; children.push(description);
    const link = el('a', 'btn', '카카오톡으로 상담하기');
    link.href = KAKAO_CHAT; link.target = '_blank'; link.rel = 'noopener noreferrer'; children.push(link);
    content.replaceChildren(...children); openDialog(dialog, close);
  }
  function drawNotices(rows) {
    const items = rows.slice(0, 5).map(row => {
      const article = el('article', 'notice-item nt-i');
      const heading = el('div', 'notice-title');
      appendText(heading, 'h3', '', str(row.title));
      appendText(heading, 'time', 'notice-date', dateText(row.created_at));
      article.append(heading);
      addParagraph(article, str(row.body), 'notice-body');
      return article;
    });
    replace('noticesMain', ...(items.length ? items : [el('p', 'sub', '등록된 공지가 없습니다.')]));
  }
  async function loadNotices() {
    setStatusPlaceholder('noticesMain', '공지사항을 불러오는 중입니다.');
    try {
      const rows = checked(await requireDB().from('notices').select('*').order('created_at', { ascending: false }).limit(5)) || [];
      drawNotices(rows); connection('공지사항', null); return true;
    } catch (error) { setStatusPlaceholder('noticesMain', errorText('공지사항을 불러오지 못했습니다', error)); connection('공지사항', error); return false; }
  }
  function drawReviews(rows) {
    const items = rows.map(row => {
      const quote = el('blockquote', 'review-card');
      const rating = appendText(quote, 'div', 'review-stars review-card__stars', stars(row.rating));
      rating.setAttribute('aria-label', `별점 ${ratingOf(row.rating)}점 (5점 만점)`);
      addParagraph(quote, str(row.content), 'review-quote');
      appendText(quote, 'cite', 'review-author', `— ${str(row.author)}`);
      return quote;
    });
    replace('reviewsGrid', ...(items.length ? items : [el('p', 'sub', '등록된 후기가 없습니다.')]));
  }
  async function loadReviews() {
    setStatusPlaceholder('reviewsGrid', '후기를 불러오는 중입니다.');
    try {
      const rows = checked(await requireDB().from('reviews').select('*').eq('visible', true).order('created_at', { ascending: false })) || [];
      drawReviews(rows); connection('후기', null); return true;
    } catch (error) { setStatusPlaceholder('reviewsGrid', errorText('후기를 불러오지 못했습니다', error)); connection('후기', error); return false; }
  }

  async function submitPublicReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = ids('publicReviewSubmit');
    if (val(form, 'website')) { form.reset(); message('publicReviewMsg', '후기가 접수되었습니다. 운영자 확인 후 공개됩니다.'); return; }
    const row = { author: val(form, 'author'), rating: Number(val(form, 'rating')), content: val(form, 'content'), visible: false };
    if (!row.author || row.author.length > 100) { message('publicReviewMsg', '표시 이름을 1~100자 이내로 입력해 주세요.', true); return; }
    if (!row.content || row.content.length > 2000) { message('publicReviewMsg', '후기를 1~2,000자 이내로 입력해 주세요.', true); return; }
    if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5) { message('publicReviewMsg', '별점은 1점부터 5점까지 선택해 주세요.', true); return; }
    setBusy(submit, true); message('publicReviewMsg', '후기를 접수하고 있습니다.');
    try {
      checked(await requireDB().from('reviews').insert(row));
      form.reset();
      message('publicReviewMsg', '후기가 접수되었습니다. 운영자 확인 후 공개됩니다.');
      if (state.admin) await loadAdminReviews();
    } catch (error) {
      const denied = error && (error.code === '42501' || /row-level security|permission denied/i.test(str(error.message)));
      message('publicReviewMsg', denied ? '후기 접수 권한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' : '후기를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
    } finally { setBusy(submit, false); }
  }

  /* Authentication: defer Supabase calls outside the auth callback to avoid its lock. */
  function drawAuth() {
    const login = ids('loginButton'), logout = ids('logoutButton'), admin = ids('adminLink');
    if (login) login.hidden = !!state.user;
    if (logout) logout.hidden = !state.user;
    if (admin) admin.hidden = !state.admin;
    const name = ids('profileName');
    if (name) name.textContent = state.user ? (state.profile?.nickname || state.user.user_metadata?.full_name || state.user.user_metadata?.name || '회원') : '';
    if (!state.admin) closeAdmin();
  }
  async function setUser(user) {
    const version = ++state.authVersion;
    const sameUser = state.user && user && sameId(state.user.id, user.id);
    if (!sameUser) { state.profile = null; state.admin = false; state.authResolved = false; }
    state.user = user || null;
    drawAuth();
    if (!user || !state.db) {
      state.authResolved = true; connection('관리자 권한', null); handleAdminHash(); return;
    }
    const results = await Promise.allSettled([
      state.db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      state.db.rpc('is_admin')
    ]);
    if (version !== state.authVersion) return;
    const profileResult = results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason };
    const adminResult = results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason };
    state.profile = profileResult.error ? null : profileResult.data;
    state.admin = !adminResult.error && adminResult.data === true;
    if (profileResult.error) connection('프로필', profileResult.error); else connection('프로필', null);
    if (adminResult.error) connection('관리자 권한', adminResult.error); else connection('관리자 권한', null);
    state.authResolved = true; drawAuth(); handleAdminHash();
  }
  function loginMessage(text, error = false) {
    const dialog = ids('loginDialog');
    if (!dialog) { message('connectionStatus', text, error); return; }
    let node = ids('loginStatus');
    if (!node) { node = el('p', 'login-status'); node.id = 'loginStatus'; dialog.append(node); }
    message('loginStatus', text, error);
  }
  async function loginWithKakao() {
    const b = ids('loginKakao'); setBusy(b, true); loginMessage('카카오 로그인으로 이동합니다.');
    try {
      checked(await requireDB().auth.signInWithOAuth({
        provider: 'kakao', options: { scopes: CONFIG.KAKAO_SCOPES || 'profile_nickname profile_image account_email', redirectTo: location.origin + '/' }
      }));
    } catch (error) { loginMessage(errorText('카카오 로그인에 실패했습니다', error), true); }
    finally { setBusy(b, false); }
  }
  async function logout() {
    const b = ids('logoutButton'); setBusy(b, true);
    try {
      checked(await requireDB().auth.signOut());
      await setUser(null);
      connection('로그아웃', null);
    } catch (error) { connection('로그아웃', error); }
    finally { setBusy(b, false); }
  }

  /* Admin navigation: pane visibility changes synchronously, independent of network. */
  function showAdminTab(tab) {
    if (!(tab in tabPanes)) tab = 'about';
    state.activeTab = tab;
    for (const [key, id] of Object.entries(tabPanes)) { const pane = ids(id); if (pane) pane.hidden = key !== tab; }
    const nav = ids('adTabs');
    nav?.querySelectorAll('button[data-tab]').forEach(b => {
      const selected = b.dataset.tab === tab;
      b.classList.toggle('on', selected); b.classList.toggle('active', selected);
      b.setAttribute('aria-selected', String(selected));
    });
    const root = ids('adminRoot'); if (root) root.scrollTop = 0;
  }
  function closeAdmin() {
    const root = ids('adminRoot');
    if (!root || root.hidden) return;
    root.hidden = true; document.body.style.overflow = state.adminOverflow;
    if (state.adminOpenedByHash && location.hash === '#admin') {
      history.replaceState(null, '', `${location.pathname}${location.search}#home`);
    }
    state.adminOpenedByHash = false;
    if (state.adminReturnFocus?.isConnected) state.adminReturnFocus.focus();
    state.adminReturnFocus = null;
  }
  function routeFromHash() {
    const route = location.hash.replace(/^#/, '');
    return Object.hasOwn(routeTitles, route) ? route : 'home';
  }
  function showRoute(route, scroll = true) {
    if (!Object.hasOwn(routeTitles, route)) route = 'home';
    state.route = route;
    document.querySelectorAll('[data-route-view]').forEach(view => {
      const active = view.dataset.routeView === route;
      view.hidden = !active;
      if (active) { view.classList.remove('page-transition'); void view.offsetWidth; view.classList.add('page-transition'); }
    });
    document.querySelectorAll('[data-route-link]').forEach(link => {
      if (link.dataset.routeLink === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = routeTitles[route];
    if (scroll) window.scrollTo(0, 0);
    syncHomeCaseAutoplay();
  }
  function handlePageLocation() {
    if (location.hash === '#admin') { handleAdminHash(); return; }
    showRoute(routeFromHash());
    handleAdminHash();
  }
  function handleAdminHash() {
    if (location.hash !== '#admin') {
      if (state.adminOpenedByHash) closeAdmin();
      connection('관리자 접근', null);
      return;
    }
    if (!state.authResolved) return;
    if (!state.admin || !state.user) {
      connection('관리자 접근', new Error('로그인 및 관리자 권한 확인이 필요합니다.'));
      return;
    }
    connection('관리자 접근', null);
    if (ids('adminRoot')?.hidden) openAdmin(true).catch(error => connection('관리자 접근', error));
  }
  async function openAdmin(fromHash = false) {
    requireAdmin();
    const root = ids('adminRoot'); if (!root) return;
    if (!root.hidden) return;
    state.adminOpenedByHash = fromHash;
    state.adminReturnFocus = document.activeElement;
    state.adminOverflow = document.body.style.overflow;
    root.hidden = false; document.body.style.overflow = 'hidden';
    showAdminTab(state.activeTab);
    if (state.siteReady) fillAboutForm();
    else message('aboutMsg', '회사소개를 불러오는 중입니다. 조회가 완료되면 저장할 수 있습니다.');
    setBusy(aboutSubmit(), !state.siteReady);
    resetCaseForm(); resetNoticeForm();
    ids('adClose')?.focus();
    await Promise.all([state.siteReady ? Promise.resolve(true) : loadSite(), loadCases(), loadAdminNotices(), loadAdminReviews()]);
  }
  function fillAboutForm() {
    const form = ids('aboutForm');
    for (const key of aboutKeys) setVal(form, key, state.site[key]?.text);
    const items = Array.isArray(state.site.history?.items) ? state.site.history.items : [];
    setVal(form, 'history', items.map(item => `${str(item?.year)}|${str(item?.text)}`).join('\n'));
  }
  async function saveAbout(event) {
    event.preventDefault(); requireAdmin();
    if (!state.siteReady) { message('aboutMsg', '회사소개 조회가 완료되지 않아 저장할 수 없습니다. 관리자 화면을 다시 열어 주세요.', true); return; }
    const form = event.currentTarget, submit = form.querySelector('[type="submit"], button:not([type])');
    const rawHistory = str(field(form, 'history')?.value);
    const existing = Array.isArray(state.site.history?.items) ? state.site.history.items : [];
    const originalHistory = existing.map(item => `${str(item?.year)}|${str(item?.text)}`).join('\n');
    const items = rawHistory === originalHistory ? existing : rawHistory.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const [year, ...rest] = line.split('|'); return { year, text: rest.join('|') };
    });
    const rows = aboutKeys.map(key => ({ key, value: { text: str(field(form, key)?.value) } })).concat({ key: 'history', value: { items } });
    setBusy(submit, true); message('aboutMsg', '저장 중입니다.');
    try {
      const saved = checkedRows(await state.db.from('site_content').upsert(rows, { onConflict: 'key' }).select('key'));
      if (new Set(saved.map(row => row.key)).size !== rows.length) throw new Error('일부 항목만 저장되었습니다. 권한과 데이터를 확인해 주세요.');
      state.site = Object.assign({}, state.site, Object.fromEntries(rows.map(row => [row.key, row.value])));
      drawAbout(); connection('회사소개', null); message('aboutMsg', '회사소개가 저장되었습니다.');
    } catch (error) { message('aboutMsg', errorText('회사소개 저장 실패', error), true); }
    finally { setBusy(submit, false); }
  }

  /* Cases + storage: delete newly uploaded objects on failure; old objects only after confirmed DB mutation. */
  function caseFormValues(item) {
    const form = ids('caseForm');
    for (const key of ['title', 'region', 'area', 'period', 'description']) setVal(form, key, item?.[key]);
    if (item?.category) setVal(form, 'category', item.category);
    const cover = field(form, 'cover'), imgs = field(form, 'imgs');
    if (cover) cover.value = ''; if (imgs) imgs.value = '';
  }
  function drawCaseThumbs() {
    const item = state.editCase;
    const thumbs = imagesOf(item).map((path, index) => {
      if (state.removedImages.has(index)) return null;
      const wrapper = el('span', 'case-thumb');
      const image = createImage(path, `기존 상세 이미지 ${index + 1}`, 'case-thumb__image');
      if (image) wrapper.append(image); else appendText(wrapper, 'span', '', '이미지 없음');
      const remove = button('×', 'remove-image', index);
      remove.setAttribute('aria-label', `상세 이미지 ${index + 1} 삭제 예정`); wrapper.append(remove);
      return wrapper;
    }).filter(Boolean);
    replace('caseThumbs', ...thumbs);
  }
  function resetCaseForm(item = null) {
    state.editCase = item; state.removedImages = new Set();
    const form = ids('caseForm'); if (!item) form?.reset();
    caseFormValues(item);
    if (ids('caseHead')) ids('caseHead').textContent = item ? '시공사례 수정' : '시공사례 등록';
    if (ids('caseSave')) ids('caseSave').textContent = item ? '수정 저장' : '등록';
    if (ids('caseCancel')) ids('caseCancel').hidden = !item;
    drawCaseThumbs();
  }
  function drawCaseList() {
    const rows = state.cases.map(item => {
      const actions = el('div', 'admin-actions');
      actions.append(button('수정', 'edit', item.id), button('삭제', 'delete', item.id));
      return listRow('caseList', [dateText(item.created_at), str(item.title), str(item.region), actions]);
    }).filter(Boolean);
    if (rows.length) replace('caseList', ...rows); else listEmpty('caseList', '등록된 시공사례가 없습니다.');
  }
  function randomPath(file) {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
    const ext = extensions[file.type];
    if (!ext) throw new Error('JPG, PNG, WebP, GIF, AVIF 이미지만 업로드할 수 있습니다.');
    if (file.size > 20 * 1024 * 1024) throw new Error('이미지는 파일당 20MB 이하여야 합니다.');
    const uid = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${uid}.${ext}`;
  }
  async function uploadImage(file) {
    const path = randomPath(file);
    checked(await state.db.storage.from('cases').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false }));
    return path;
  }
  async function removeImages(paths) {
    const unique = [...new Set(paths.filter(path => typeof path === 'string' && path.trim() && !/^(?:[a-z]+:|\/\/)/i.test(path)))];
    if (!unique.length) return '';
    try {
      const removed = checked(await state.db.storage.from('cases').remove(unique));
      if (!Array.isArray(removed) || removed.length < unique.length) return '일부 파일이 삭제되지 않았습니다. Storage 권한과 파일 상태를 확인해 주세요.';
      return '';
    }
    catch (error) { return detail(error); }
  }
  async function cleanupUnreferenced(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return '';
    try {
      // Avoid deleting a path still used in any case. If the check fails, retain the files.
      const rows = checked(await state.db.from('cases').select('cover_path,images')) || [];
      const used = new Set(rows.flatMap(row => [row.cover_path, ...imagesOf(row)]).filter(Boolean));
      return await removeImages(unique.filter(path => !used.has(path)));
    } catch (error) { return `참조 확인 실패: ${detail(error)}`; }
  }
  async function saveCase(event) {
    event.preventDefault(); requireAdmin();
    const form = event.currentTarget, submit = ids('caseSave'), current = state.editCase;
    if (!val(form, 'title')) { message('caseMsg', '시공사례 제목을 입력해 주세요.', true); return; }
    const uploaded = [];
    let committed = false;
    setBusy(submit, true); message('caseMsg', '저장 중입니다.');
    try {
      let cover = current?.cover_path || null;
      const oldImages = imagesOf(current);
      const keep = oldImages.filter((_, index) => !state.removedImages.has(index));
      const oldCandidates = oldImages.filter((_, index) => state.removedImages.has(index));
      const coverFile = field(form, 'cover')?.files?.[0];
      if (!current && !coverFile) throw new Error('신규 시공사례의 대표 이미지를 선택해 주세요.');
      if (coverFile) { const path = await uploadImage(coverFile); uploaded.push(path); if (cover) oldCandidates.push(cover); cover = path; }
      for (const file of Array.from(field(form, 'imgs')?.files || [])) { const path = await uploadImage(file); uploaded.push(path); keep.push(path); }
      const row = { title: val(form, 'title'), region: val(form, 'region'), area: val(form, 'area'), period: val(form, 'period'), category: val(form, 'category'), description: val(form, 'description'), cover_path: cover, images: keep };
      const query = current ? state.db.from('cases').update(row).eq('id', current.id) : state.db.from('cases').insert(row);
      checkedRows(await query.select('id'));
      committed = true;
      const warning = await cleanupUnreferenced(oldCandidates);
      resetCaseForm();
      const refreshed = await loadCases();
      message('caseMsg', `${current ? '수정' : '등록'}되었습니다.${warning ? ` 이전 이미지 정리 실패: ${warning}` : ''}${!refreshed ? ' 목록 새로고침에 실패했습니다.' : ''}`, !!warning || !refreshed);
    } catch (error) {
      let warning = '';
      if (!committed && uploaded.length) warning = await removeImages(uploaded);
      message('caseMsg', `${errorText(committed ? '시공사례는 저장되었으나 후속 처리 실패' : '시공사례 저장 실패', error)}${warning ? ` · 새 이미지 정리 실패: ${warning}` : ''}`, true);
    } finally { setBusy(submit, false); }
  }
  async function caseListAction(event) {
    const b = event.target.closest('button[data-action]'); if (!b) return;
    requireAdmin();
    const item = state.cases.find(row => sameId(row.id, b.dataset.id));
    if (!item) { message('caseMsg', '항목을 찾을 수 없습니다. 목록을 다시 불러와 주세요.', true); return; }
    if (b.dataset.action === 'edit') { resetCaseForm(item); message('caseMsg', ''); field(ids('caseForm'), 'title')?.focus(); return; }
    if (b.dataset.action !== 'delete' || !window.confirm(`'${str(item.title)}' 시공사례를 삭제할까요?`)) return;
    setBusy(b, true); message('caseMsg', '삭제 중입니다.');
    try {
      checkedRows(await state.db.from('cases').delete().eq('id', item.id).select('id'));
      const warning = await cleanupUnreferenced([item.cover_path, ...imagesOf(item)]);
      if (state.editCase && sameId(state.editCase.id, item.id)) resetCaseForm();
      const refreshed = await loadCases();
      message('caseMsg', `삭제되었습니다.${warning ? ` 이미지 정리 실패: ${warning}` : ''}${!refreshed ? ' 목록 새로고침에 실패했습니다.' : ''}`, !!warning || !refreshed);
    } catch (error) { message('caseMsg', errorText('시공사례 삭제 실패', error), true); }
    finally { setBusy(b, false); }
  }

  /* Notices */
  function resetNoticeForm(item = null) {
    state.editNotice = item;
    const form = ids('noticeForm'); if (!item) form?.reset();
    setVal(form, 'title', item?.title); setVal(form, 'body', item?.body);
    if (ids('noticeHead')) ids('noticeHead').textContent = item ? '공지 수정' : '공지 작성';
    if (ids('noticeSave')) ids('noticeSave').textContent = item ? '수정 저장' : '등록';
    if (ids('noticeCancel')) ids('noticeCancel').hidden = !item;
  }
  function drawAdminNotices() {
    const rows = state.notices.map(item => {
      const actions = el('div', 'admin-actions');
      actions.append(button('수정', 'edit', item.id), button('삭제', 'delete', item.id));
      return listRow('noticeListAdmin', [dateText(item.created_at), str(item.title), actions]);
    }).filter(Boolean);
    if (rows.length) replace('noticeListAdmin', ...rows); else listEmpty('noticeListAdmin', '등록된 공지가 없습니다.');
  }
  async function loadAdminNotices() {
    if (!state.admin) return false;
    listEmpty('noticeListAdmin', '공지사항을 불러오는 중입니다.');
    try {
      const rows = checked(await state.db.from('notices').select('*').order('created_at', { ascending: false })) || [];
      if (!state.admin) return false;
      state.notices = rows; drawAdminNotices(); return true;
    } catch (error) { listEmpty('noticeListAdmin', '공지 목록을 불러오지 못했습니다.'); message('noticeMsg', errorText('공지 목록 조회 실패', error), true); return false; }
  }
  async function saveNotice(event) {
    event.preventDefault(); requireAdmin();
    const form = event.currentTarget, submit = ids('noticeSave'), current = state.editNotice;
    const row = { title: val(form, 'title'), body: val(form, 'body') };
    if (!row.title) { message('noticeMsg', '공지 제목을 입력해 주세요.', true); return; }
    setBusy(submit, true); message('noticeMsg', '저장 중입니다.');
    try {
      const query = current ? state.db.from('notices').update(row).eq('id', current.id) : state.db.from('notices').insert(row);
      checkedRows(await query.select('id')); resetNoticeForm();
      const results = await Promise.all([loadNotices(), loadAdminNotices()]);
      message('noticeMsg', `공지사항이 저장되었습니다.${results.includes(false) ? ' 목록 새로고침에 실패했습니다.' : ''}`, results.includes(false));
    } catch (error) { message('noticeMsg', errorText('공지 저장 실패', error), true); }
    finally { setBusy(submit, false); }
  }
  async function noticeListAction(event) {
    const b = event.target.closest('button[data-action]'); if (!b) return;
    requireAdmin();
    const item = state.notices.find(row => sameId(row.id, b.dataset.id));
    if (!item) { message('noticeMsg', '항목을 찾을 수 없습니다.', true); return; }
    if (b.dataset.action === 'edit') { resetNoticeForm(item); message('noticeMsg', ''); field(ids('noticeForm'), 'title')?.focus(); return; }
    if (b.dataset.action !== 'delete' || !window.confirm('이 공지사항을 삭제할까요?')) return;
    setBusy(b, true); message('noticeMsg', '삭제 중입니다.');
    try {
      checkedRows(await state.db.from('notices').delete().eq('id', item.id).select('id'));
      if (state.editNotice && sameId(state.editNotice.id, item.id)) resetNoticeForm();
      const results = await Promise.all([loadNotices(), loadAdminNotices()]);
      message('noticeMsg', `삭제되었습니다.${results.includes(false) ? ' 목록 새로고침에 실패했습니다.' : ''}`, results.includes(false));
    } catch (error) { message('noticeMsg', errorText('공지 삭제 실패', error), true); }
    finally { setBusy(b, false); }
  }

  /* Reviews */
  function drawAdminReviews() {
    const rows = state.reviews.map(item => {
      const content = el('div');
      const rating = appendText(content, 'span', 'review-card__stars', stars(item.rating));
      rating.setAttribute('aria-label', `별점 ${ratingOf(item.rating)}점 (5점 만점)`);
      addParagraph(content, str(item.content)); appendText(content, 'small', '', str(item.author));
      appendText(content, 'small', '', item.visible ? ' · 공개' : ' · 숨김');
      const actions = el('div', 'admin-actions');
      actions.append(button(item.visible ? '숨기기' : '공개하기', 'visibility', item.id), button('삭제', 'delete', item.id));
      return listRow('reviewListAdmin', [dateText(item.created_at), content, actions]);
    }).filter(Boolean);
    if (rows.length) replace('reviewListAdmin', ...rows); else listEmpty('reviewListAdmin', '등록된 후기가 없습니다.');
  }
  async function loadAdminReviews() {
    if (!state.admin) return false;
    listEmpty('reviewListAdmin', '후기를 불러오는 중입니다.');
    try {
      const rows = checked(await state.db.from('reviews').select('*').order('created_at', { ascending: false })) || [];
      if (!state.admin) return false;
      state.reviews = rows; drawAdminReviews(); return true;
    } catch (error) { listEmpty('reviewListAdmin', '후기 목록을 불러오지 못했습니다.'); message('reviewMsg', errorText('후기 목록 조회 실패', error), true); return false; }
  }
  async function saveReview(event) {
    event.preventDefault(); requireAdmin();
    const form = event.currentTarget, submit = form.querySelector('[type="submit"], button:not([type])');
    const rating = Number(val(form, 'rating'));
    const row = { author: val(form, 'author'), rating, content: val(form, 'content'), visible: true };
    if (!row.author || !row.content) { message('reviewMsg', '작성자와 후기 내용을 입력해 주세요.', true); return; }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) { message('reviewMsg', '별점은 1점부터 5점까지 선택해 주세요.', true); return; }
    setBusy(submit, true); message('reviewMsg', '저장 중입니다.');
    try {
      checkedRows(await state.db.from('reviews').insert(row).select('id')); form.reset();
      const results = await Promise.all([loadReviews(), loadAdminReviews()]);
      message('reviewMsg', `후기가 등록되었습니다.${results.includes(false) ? ' 목록 새로고침에 실패했습니다.' : ''}`, results.includes(false));
    } catch (error) { message('reviewMsg', errorText('후기 등록 실패', error), true); }
    finally { setBusy(submit, false); }
  }
  async function reviewListAction(event) {
    const b = event.target.closest('button[data-action]'); if (!b) return;
    requireAdmin();
    const item = state.reviews.find(row => sameId(row.id, b.dataset.id));
    if (!item) { message('reviewMsg', '항목을 찾을 수 없습니다.', true); return; }
    const action = b.dataset.action;
    if (action === 'delete' && !window.confirm('이 후기를 삭제할까요?')) return;
    if (action !== 'delete' && action !== 'visibility') return;
    setBusy(b, true); message('reviewMsg', '처리 중입니다.');
    try {
      const query = action === 'delete' ? state.db.from('reviews').delete().eq('id', item.id) : state.db.from('reviews').update({ visible: !item.visible }).eq('id', item.id);
      checkedRows(await query.select('id'));
      const results = await Promise.all([loadReviews(), loadAdminReviews()]);
      message('reviewMsg', `${action === 'delete' ? '삭제되었습니다.' : item.visible ? '후기를 숨겼습니다.' : '후기를 공개했습니다.'}${results.includes(false) ? ' 목록 새로고침에 실패했습니다.' : ''}`, results.includes(false));
    } catch (error) { message('reviewMsg', errorText('후기 처리 실패', error), true); }
    finally { setBusy(b, false); }
  }

  function bindEvents() {
    bindDialog(ids('loginDialog')); bindDialog(ids('caseDialog'));
    on('loginButton', 'click', () => { loginMessage(''); openDialog(ids('loginDialog'), ids('loginKakao')); });
    on('closeLogin', 'click', () => closeDialog(ids('loginDialog')));
    asyncOn('loginKakao', 'click', loginWithKakao, 'connectionStatus');
    asyncOn('logoutButton', 'click', logout, 'connectionStatus');
    on('mobileMenuButton', 'click', () => {
      const nav = ids('siteNav'), b = ids('mobileMenuButton'); if (!nav) return;
      const expanded = nav.classList.toggle('open'); b.setAttribute('aria-expanded', String(expanded));
    });
    on('siteNav', 'click', event => {
      if (!event.target.closest('a')) return;
      ids('siteNav')?.classList.remove('open'); ids('mobileMenuButton')?.setAttribute('aria-expanded', 'false');
    });
    on('casesGrid', 'click', event => { const b = event.target.closest('button[data-case-id]'); if (b) openCase(b.dataset.caseId); });
    on('homeCaseSlides', 'click', event => { const b = event.target.closest('button[data-case-id]'); if (b) openCase(b.dataset.caseId); });
    on('homeCasePrev', 'click', () => setHomeCaseIndex(state.homeCaseIndex - 1));
    on('homeCaseNext', 'click', () => setHomeCaseIndex(state.homeCaseIndex + 1));
    on('homeCaseDots', 'click', event => {
      const dot = event.target.closest('button[data-slide-index]');
      if (dot) setHomeCaseIndex(Number(dot.dataset.slideIndex));
    });
    on('homeCaseToggle', 'click', () => {
      state.homeCasePaused = !state.homeCasePaused;
      const toggle = ids('homeCaseToggle');
      if (toggle) { toggle.textContent = state.homeCasePaused ? '자동 넘김 시작' : '자동 넘김 멈춤'; toggle.setAttribute('aria-pressed', String(state.homeCasePaused)); }
      syncHomeCaseAutoplay();
    });
    on('caseDialogContent', 'click', event => { if (event.target.closest('[data-action="close-case"]')) closeDialog(ids('caseDialog')); });
    asyncOn('adminLink', 'click', event => { event.preventDefault(); return openAdmin(); }, 'connectionStatus');
    on('adClose', 'click', closeAdmin);
    window.addEventListener('hashchange', handlePageLocation);
    on('adTabs', 'click', event => {
      const b = event.target.closest('button[data-tab]');
      if (b && Object.hasOwn(tabPanes, b.dataset.tab)) showAdminTab(b.dataset.tab);
    });
    asyncOn('aboutForm', 'submit', saveAbout, 'aboutMsg');
    asyncOn('caseForm', 'submit', saveCase, 'caseMsg');
    on('caseCancel', 'click', () => { resetCaseForm(); message('caseMsg', ''); });
    on('caseThumbs', 'click', event => {
      const b = event.target.closest('button[data-action="remove-image"]');
      if (!b) return;
      const index = Number(b.dataset.id);
      if (Number.isInteger(index) && index >= 0) { state.removedImages.add(index); drawCaseThumbs(); }
    });
    asyncOn('caseList', 'click', caseListAction, 'caseMsg');
    asyncOn('noticeForm', 'submit', saveNotice, 'noticeMsg');
    on('noticeCancel', 'click', () => { resetNoticeForm(); message('noticeMsg', ''); });
    asyncOn('noticeListAdmin', 'click', noticeListAction, 'noticeMsg');
    asyncOn('reviewForm', 'submit', saveReview, 'reviewMsg');
    asyncOn('reviewListAdmin', 'click', reviewListAction, 'reviewMsg');
    asyncOn('publicReviewForm', 'submit', submitPublicReview, 'publicReviewMsg');
  }
  async function init() {
    captureAboutDefaults(); bindEvents(); drawAuth(); showAdminTab('about');
    if (location.pathname.replace(/\/+$/, '') === '/admin') history.replaceState(null, '', '/#admin');
    if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#home`);
    showRoute(routeFromHash(), false);
    setBusy(aboutSubmit(), true);
    message('casesStatus', '시공사례를 불러오는 중입니다.');
    setStatusPlaceholder('reviewsGrid', '후기를 불러오는 중입니다.');
    setStatusPlaceholder('noticesMain', '공지사항을 불러오는 중입니다.');
    try {
      const url = CONFIG.SUPABASE_URL, key = CONFIG.SUPABASE_ANON_KEY;
      if (!url || !key || /YOUR[_-]?/i.test(url) || /YOUR[_-]?/i.test(key) || !window.supabase?.createClient) throw new Error('config.js의 Supabase URL, anon key와 라이브러리를 확인해 주세요.');
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Supabase URL이 올바르지 않습니다.');
      state.db = window.supabase.createClient(url, key, { auth: { flowType: 'pkce' } });
      connection('설정', null);
      let authEvents = 0;
      state.db.auth.onAuthStateChange((_event, session) => {
        // The callback itself is synchronous: async profile/RPC work happens after the auth lock is released.
        const observed = ++authEvents;
        window.setTimeout(() => {
          if (observed !== authEvents) return;
          setUser(session?.user || null).catch(error => connection('인증', error));
        }, 0);
      });
      const requestVersion = authEvents;
      const authPromise = state.db.auth.getSession().then(result => {
        const data = checked(result);
        if (authEvents === requestVersion) return setUser(data?.session?.user || null);
      }).catch(error => {
        connection('인증', error);
        if (authEvents === requestVersion) return setUser(null);
      });
      await Promise.all([authPromise, loadCases(), loadSite(), loadNotices(), loadReviews()]);
    } catch (error) {
      connection('설정', error);
      message('casesStatus', '서비스 설정을 확인해 주세요.', true);
      setStatusPlaceholder('reviewsGrid', '후기를 불러올 수 없습니다.');
      setStatusPlaceholder('noticesMain', '공지사항을 불러올 수 없습니다.');
      for (const id of Object.values(aboutIds)) message(id, '회사소개를 불러올 수 없습니다.', true);
      message('aboutHistory', '연혁을 불러올 수 없습니다.', true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init().catch(error => connection('초기화', error)); }, { once: true });
  else init().catch(error => connection('초기화', error));
})();
