(() => {
  const M = ReviewModel;
  const $ = id => document.getElementById(id);
  const catalog = new Map(catalogData.map(problem => [problem[0], problem]));
  const bySlug = new Map(catalogData.map(problem => [problem[2], problem]));
  const grind = lists.grind.problems.map(([slug, minutes, difficulty, priority, topic]) =>
    ({id: bySlug.get(slug)[0], minutes, difficulty, priority, topic}));
  const grindById = new Map(grind.map(problem => [problem.id, problem]));
  const sourceLabels = Object.entries(lists.labels).map(([key, list]) => ({key, ...list, members: new Set(list.slugs)}));
  const storageKey = 'drycanvas-review-v1';
  const query = new URLSearchParams(location.search);
  let storedLang;
  try { storedLang = localStorage.getItem('drycanvas-lang'); } catch {}
  function normalizeLang(value) {
    const code = (value || '').toLowerCase();
    if (code.startsWith('zh')) return /cn|sg|hans/.test(code) ? 'zh-CN' : 'zh-TW';
    const base = code.split('-')[0];
    return ['en', 'ja', 'ko', 'fr', 'hi'].includes(base) ? base : null;
  }
  const lang = [query.get('lang'), storedLang, ...(navigator.languages || [navigator.language])]
    .map(normalizeLang).find(Boolean) || 'en';
  const t = (zh, en) => lang === 'zh-TW' ? zh : translations[lang]?.[zh] || en;
  const grindOrderings = [
    ['all_rounded', t('均衡排序', 'All Rounded')],
    ['difficulty', t('依難度排序', 'Order by Difficulty')],
    ['topics', t('依主題排序', 'Order by Topics')],
  ];
  document.documentElement.lang = {'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans'}[lang] || lang;
  document.title = t('題目複習', 'Problem review');

  const labels = {
    new: t('沒寫過', 'New'), weak: t('待加強', 'Needs practice'), known: t('自評會・待驗證', 'Self-rated · check pending'),
    learned: t('已學會・待重寫', 'Learned · rewrite pending'), verified: t('已驗證能獨立完成', 'Verified independent'),
  };
  const kinds = {
    rewrite: t('完整重寫', 'Full rewrite'), recall: t('快速回想', 'Quick recall'),
    transfer: t('遷移練習', 'Transfer practice'), correction: t('訂正重寫', 'Correction rewrite'),
  };
  const grades = [
    t('忘記或未完成', 'Forgot or unfinished'), t('有提示才完成', 'Completed with hints'),
    t('獨立完成但卡頓', 'Independent with difficulty'), t('熟練掌握', 'Fluent'),
  ];
  const tabs = {
    today: t('今天', 'Today'), plan: t('學習計畫', 'Study plan'),
    upcoming: t('複習排程', 'Review schedule'), all: t('全部題目', 'All problems'),
  };

  let state = {version: 1, plan: null, records: {}};
  let raw = null;
  let damaged = false;
  try {
    raw = localStorage.getItem(storageKey);
    if (raw !== null) state = M.validate(JSON.parse(raw), catalog);
  } catch {
    damaged = raw !== null;
    $('notice').textContent = t('無法讀取複習資料。可匯入有效備份來還原。', 'Could not read review data. Import a valid backup to restore it.');
  }
  const defaultStart = M.today();
  const grindDefaults = {start: defaultStart, weeks: 9, hours: 10, order: 'all_rounded', difficulties: ['Medium']};
  let tab = 'today';
  let filters = {text: '', status: '', source: ''};

  function el(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
      else if (name === 'class') element.className = value;
      else if (name === 'aria') Object.entries(value).forEach(([key, text]) => element.setAttribute('aria-' + key, text));
      else element[name] = value;
    }
    element.append(...children.filter(child => child !== null && child !== undefined));
    return element;
  }

  const button = (text, action, primary = false) =>
    el('button', {type: 'button', class: primary ? 'primary' : '', onclick: action}, text);
  const submit = text => el('button', {type: 'submit', class: 'primary'}, text);
  const link = (text, href, external = false) =>
    el('a', external ? {href, target: '_blank', rel: 'noopener'} : {href}, text);
  const field = (text, input) => el('label', {class: 'field'}, el('span', {}, text), input);
  const paragraph = text => el('p', {class: 'muted'}, text);
  const actions = (...children) => el('div', {class: 'actions'}, ...children);
  const section = (title, ...children) => el('section', {}, el('h2', {}, title), ...children);
  const titleOf = id => '#' + id + ' ' + catalog.get(id)[1];
  const lc = id => 'https://leetcode.com/problems/' + catalog.get(id)[2] + '/';
  const options = (values, selected) => values.map(([value, text]) =>
    el('option', {value, selected: value === selected}, text));

  function select(values, selected, label) {
    return el('select', label ? {aria: {label}} : {}, ...options(values, selected));
  }

  function dialog(title, ...content) {
    const modal = $('dialog');
    modal.replaceChildren(
      el('div', {class: 'dialog-header'}, el('h2', {id: 'dialog-title'}, title),
        button(t('關閉', 'Close'), () => modal.close())),
      ...content,
    );
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
  }

  function errorLine() {
    return el('p', {class: 'error', role: 'alert'});
  }

  function save(next, error, message, replace = false) {
    try {
      if (damaged && !replace) throw new Error('Unreadable local data');
      if (localStorage.getItem(storageKey) !== raw) {
        error.textContent = t('另一個分頁已更新資料。請保留這次輸入，重新整理後再儲存。', 'Another tab updated the data. Keep your input and reload before saving.');
        return false;
      }
      const json = JSON.stringify(next);
      localStorage.setItem(storageKey, json);
      raw = json;
      state = next;
      damaged = false;
    } catch {
      error.textContent = t('無法儲存。瀏覽器的儲存空間可能已滿或無法使用。', 'Could not save. Browser storage may be full or unavailable.');
      return false;
    }
    $('notice').textContent = message;
    render();
    return true;
  }

  function planFor(state) {
    const saved = state.plan;
    if (saved?.order) return saved;
    const settings = saved
      ? {...grindDefaults, start: saved.start, weeks: saved.weeks, hours: saved.hours}
      : grindDefaults;
    return M.makePlan(settings, grind);
  }

  function tags(id, custom = true) {
    const badges = sourceLabels.filter(list => list.members.has(catalog.get(id)[2]))
      .map(list => el('span', {class: 'tag'}, list.title));
    if (custom) {
      for (const tag of state.records[id]?.tags ?? []) badges.push(el('span', {class: 'tag'}, tag));
    }
    return el('div', {class: 'tags'}, ...badges);
  }

  function row(id, meta, controls, checkbox = null, blind = false) {
    return el('div', {class: 'row'}, checkbox,
      el('div', {class: 'row-main'}, el('strong', {}, titleOf(id)),
        el('div', {class: 'row-meta'}, ...meta, tags(id, !blind))),
      actions(...controls));
  }

  function reviewRows(entries, date) {
    return entries.map(([id, current]) =>
      row(id, [el('time', {dateTime: current.due, class: current.due < date ? 'overdue' : ''}, current.due), labels[current.status]],
        [button(current.status === 'known' ? t('開始無提示重寫', 'Start blind rewrite') : t('開始複習', 'Start review'),
          () => practice(id), true)], null, true));
  }

  function todayView(entries, date, plan) {
    const due = entries.filter(([, item]) => item.due <= date && item.status !== 'known');
    const checks = entries.filter(([, item]) => item.status === 'known' && item.due <= date);
    const week = Math.floor(M.daysBetween(plan.start, date) / 7);
    const backlog = plan.assignments.slice(0, Math.max(0, week)).flatMap((ids, index) =>
      ids.filter(id => !state.records[id]).map(id => [id, index]));
    const assigned = (plan.assignments[week] || []).filter(id => !state.records[id]);
    const overdue = due.filter(([, item]) => item.due < date).length;
    const empty = t('目前沒有待辦。', 'Nothing due.');
    const start = (id, meta) => {
      const problem = grindById.get(id);
      return row(id, [...meta, problem ? problem.minutes + ' min' : null],
        [button(t('開始練習', 'Start practice'), () => practice(id, true), true)]);
    };
    const weekLabel = t('本週新題', 'New problems this week') +
      (week >= 0 && week < plan.weeks ? ' · ' + t('週次', 'Week') + ' ' + (week + 1) : '');
    return [
      section(t('待複習', 'Due reviews'), paragraph(t('逾期／今天', 'Overdue / today') + ' · ' + overdue + ' / ' + (due.length - overdue)),
        ...(due.length ? reviewRows(due, date) : [paragraph(empty)])),
      section(t('待驗證', 'Verification') + ' · ' + checks.length, ...(checks.length ? reviewRows(checks, date) : [paragraph(empty)])),
      section(weekLabel, actions(button(t('查看學習計畫', 'View study plan'), () => go('plan'))),
        ...assigned.map(id => start(id, [])), !assigned.length && !backlog.length ? paragraph(empty) : null,
        ...backlog.map(([id, index]) => start(id, [el('span', {class: 'overdue'}, t('逾週', 'Carried over') + ' · ' + t('週次', 'Week') + ' ' + (index + 1))]))),
    ];
  }

  function planSections(plan, preview = false) {
    const date = M.today();
    if (!plan.assignments.length) return [paragraph(t('這組設定沒有排入題目。', 'No problems fit these settings.'))];
    return plan.assignments.map((ids, index) => {
      const start = M.plusDays(plan.start, index * 7);
      const done = ids.filter(id => {
        const record = state.records[id];
        return record && (record.baseline || M.schedule(record).verified);
      }).length;
      const minutes = Math.ceil(ids.reduce((total, id) => total + M.estimatedMinutes(grindById.get(id)?.minutes ?? 0), 0));
      const group = el('details', {class: 'panel', open: preview || (start <= date && date <= M.plusDays(start, 6))},
        el('summary', {}, t('週次', 'Week') + ' ' + (index + 1) + ' · ' + start + ' – ' + M.plusDays(start, 6)
          + ' · ' + minutes + ' min · ' + done + '/' + ids.length));
      for (const id of ids) {
        const tracked = state.records[id];
        const problem = grindById.get(id);
        group.append(row(id, [problem?.difficulty, problem ? problem.minutes + ' min' : null,
          tracked ? labels[M.schedule(tracked).status] : null],
          preview ? [] : [button(tracked ? t('詳情', 'Details') : t('開始練習', 'Start practice'),
            () => tracked ? detail(id) : practice(id, true))]));
      }
      return group;
    });
  }

  function planView(plan) {
    const start = el('input', {type: 'date', min: '1000-01-01', max: '9998-12-31', required: true, value: plan.start});
    const weeks = el('input', {type: 'number', min: '1', max: '52', required: true, value: plan.weeks});
    const hours = el('input', {type: 'number', min: '0.25', max: '40', step: '0.25', required: true, value: plan.hours});
    const orderLabel = t('排序', 'Order');
    const order = select(grindOrderings, plan.order, orderLabel);
    const difficulties = M.difficulties.map(value => el('input', {
      type: 'checkbox', value, checked: plan.difficulties.includes(value),
    }));
    const form = el('form', {onsubmit: event => {
      event.preventDefault();
      const draft = M.makePlan({
        start: start.value, weeks: weeks.valueAsNumber, hours: hours.valueAsNumber, order: order.value,
        difficulties: difficulties.filter(input => input.checked).map(input => input.value),
      }, grind);
      const error = errorLine();
      dialog(t('預覽新題計畫', 'Preview new plan'),
        actions(button(t('套用計畫', 'Apply plan'), () => {
          if (save({...state, plan: draft}, error, t('已儲存計畫。', 'Plan saved.'))) $('dialog').close();
        }, true)), error, ...planSections(draft, true));
    }}, el('div', {class: 'filters'}, field(t('起始日', 'Start date'), start), field(t('週數', 'Weeks'), weeks),
      field(t('每週時數', 'Hours per week'), hours), field(orderLabel, order)),
    el('fieldset', {}, el('legend', {}, t('難度', 'Difficulty')),
      actions(...difficulties.map(input => el('label', {}, input, ' ' + input.value)))),
    actions(submit(t('預覽變更', 'Preview changes')), button(t('盤點以前寫過的題目', 'Mark previously attempted problems'), inventory)));
    return [section('Grind 75', form), ...planSections(plan)];
  }

  function match(id, search) {
    const problem = catalog.get(id);
    const needle = search.trim().toLowerCase().replace(/^#/, '');
    if (/^\d+$/.test(needle)) return String(id).includes(needle);
    return [problem[1], problem[2], ...(state.records[id]?.tags || [])].some(value => value.toLowerCase().includes(needle));
  }

  function allView() {
    const searchLabel = t('搜尋題號、題名或演算法', 'Search by number, title or pattern');
    const search = el('input', {type: 'search', value: filters.text, placeholder: searchLabel, aria: {label: searchLabel}});
    const status = select([['', t('所有狀態', 'All statuses')], ...Object.entries(labels)], filters.status, t('熟練狀態', 'Proficiency'));
    const source = select([['', t('所有清單', 'All lists')], ['grind', 'Grind 75'],
      ...sourceLabels.map(list => [list.key, list.title])], filters.source, t('清單標籤', 'List label'));
    const results = el('div');
    function draw(limit = 60) {
      filters = {text: search.value, status: status.value, source: source.value};
      const list = sourceLabels.find(label => label.key === source.value);
      const ids = [...catalog.keys()].filter(id => {
        const record = state.records[id];
        return (!status.value || (record ? M.schedule(record).status : 'new') === status.value) &&
          (source.value !== 'grind' || grindById.has(id)) &&
          (!list || list.members.has(catalog.get(id)[2])) && match(id, search.value);
      });
      ids.sort((a, b) => Number(!!state.records[b]) - Number(!!state.records[a]) || a - b);
      results.replaceChildren(paragraph(t('符合題數', 'Matching problems') + ' · ' + ids.length),
        ...ids.slice(0, limit).map(id => row(id, [labels[state.records[id] ? M.schedule(state.records[id]).status : 'new']],
          [button(t('詳情', 'Details'), () => detail(id))])));
      if (ids.length > limit) results.append(button(t('顯示更多', 'Show more'), () => draw(limit + 60)));
    }
    search.addEventListener('input', () => draw());
    status.addEventListener('change', () => draw());
    source.addEventListener('change', () => draw());
    draw();
    return [section(tabs.all, el('div', {class: 'filters'}, search, status, source), results)];
  }

  function render() {
    const date = M.today();
    const plan = planFor(state);
    const entries = Object.entries(state.records).map(([id, record]) => [Number(id), M.schedule(record)])
      .filter(([, item]) => item.due).sort((a, b) => a[1].due.localeCompare(b[1].due) || a[0] - b[0]);
    $('tabs').replaceChildren(...Object.entries(tabs).map(([key, text]) => {
      const item = button(text, () => go(key));
      if (tab === key) item.setAttribute('aria-current', 'page');
      return item;
    }));
    const views = {
      today: () => todayView(entries, date, plan), plan: () => planView(plan), all: allView,
      upcoming: () => {
        const future = entries.filter(([, item]) => item.due > date);
        return [section(tabs.upcoming, ...(future.length ? reviewRows(future, date) :
          [paragraph(t('目前沒有未來到期的題目。', 'No upcoming reviews.'))]))];
      },
    };
    $('view').replaceChildren(...views[tab]());
  }

  function go(key) {
    tab = key;
    render();
    $('tabs').querySelector('[aria-current="page"]').focus();
  }

  function inventory() {
    const chosen = new Set();
    const searchLabel = t('搜尋題號或題名', 'Search by number or title');
    const search = el('input', {type: 'search', placeholder: searchLabel, aria: {label: searchLabel}});
    const status = select([['', t('所有狀態', 'All statuses')], ...Object.entries(labels)], '', t('熟練狀態', 'Proficiency'));
    const results = el('div');
    const count = paragraph('');
    const error = errorLine();
    function mark(ids, kind) {
      if (!ids.length) {
        error.textContent = t('請先勾選題目。', 'Select at least one problem.');
        return;
      }
      const next = M.markPrior({...state, plan: planFor(state)}, ids, kind, M.today(), Date.now());
      if (save(next, error, t('已更新舊題盤點。', 'Prior problems updated.'))) {
        chosen.clear();
        error.textContent = '';
        draw();
      }
    }
    const known = t('寫過，自評會', 'Attempted · I can solve it');
    const weak = t('寫過但不熟', 'Attempted · needs practice');
    function updateCount() {
      count.textContent = t('已勾選', 'Selected') + ' · ' + chosen.size;
    }
    function draw() {
      const rows = [];
      for (const {id} of grind) {
        const record = state.records[id];
        const current = record ? M.schedule(record) : {status: 'new'};
        if ((status.value && status.value !== current.status) || !match(id, search.value)) continue;
        const locked = record?.history.some(item => ['rewrite', 'recall'].includes(item.kind));
        const checkbox = el('input', {type: 'checkbox', checked: chosen.has(id), disabled: locked,
          aria: {label: titleOf(id)}, onchange: event => {
            if (event.target.checked) chosen.add(id);
            else chosen.delete(id);
            updateCount();
          }});
        rows.push(row(id, [labels[current.status], current.due],
          locked ? [] : [button(weak, () => mark([id], 'weak')), button(known, () => mark([id], 'known'))], checkbox));
      }
      results.replaceChildren(...rows);
      updateCount();
    }
    search.addEventListener('input', draw);
    status.addEventListener('change', draw);
    draw();
    dialog(t('盤點以前寫過的題目', 'Mark previously attempted problems'),
      el('div', {class: 'filters'}, search, status),
      actions(button(weak, () => mark([...grindById.keys()].filter(id => chosen.has(id)), 'weak')),
        button(known, () => mark([...grindById.keys()].filter(id => chosen.has(id)), 'known'), true)), count, error, results);
  }

  function picker(onPick, allowed = () => true) {
    const text = t('搜尋題號或題名', 'Search by number or title');
    const search = el('input', {type: 'search', placeholder: text, aria: {label: text}});
    const results = el('div');
    const prioritized = [...grindById.keys(), ...[...catalog.keys()].filter(id => !grindById.has(id))];
    function draw() {
      const ids = prioritized.filter(id => allowed(id) && match(id, search.value)).slice(0, 10);
      results.replaceChildren(...ids.map(id => row(id, [], [button(t('選取', 'Select'), () => onPick(id))])));
    }
    search.addEventListener('input', draw);
    draw();
    return el('div', {}, search, results);
  }

  function detail(id) {
    const tracked = state.records[id];
    const record = tracked ?? M.emptyRecord();
    const current = M.schedule(record);
    const date = el('input', {type: 'date', value: M.today(), max: M.today(), required: true});
    const note = el('textarea', {value: record.note});
    const custom = el('input', {value: record.tags.join(', ')});
    const error = errorLine();
    const form = el('form', {onsubmit: event => {
      event.preventDefault();
      const at = Date.now();
      const tags = [...new Set(custom.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))];
      const baseline = tracked ? record.baseline : {kind: 'learned', date: date.value, due: M.plusDays(date.value, 1), at};
      const next = {...state, plan: planFor(state), records: {...state.records, [id]: {...record, baseline, note: note.value, tags, noteAt: at}}};
      if (save(next, error, t('已儲存題目。', 'Problem saved.'))) detail(id);
    }}, tracked ? null : field(t('學會日期', 'Date learned'), date),
    field(t('演算法標籤（逗號分隔）', 'Pattern tags (comma separated)'), custom),
    field(t('核心觀念與筆記', 'Key ideas and notes'), note), error,
    actions(submit(tracked ? t('儲存筆記', 'Save notes') : t('確認已學會', 'Confirm learned'))));
    const history = el('div', {class: 'history'}, el('h3', {}, t('練習歷史', 'Practice history')));
    const rewrites = record.history.filter(item => item.kind === 'rewrite');
    let rewriteIndex = 0;
    for (const item of record.history) {
      const previous = item.kind === 'rewrite' ? rewrites[++rewriteIndex] : null;
      history.append(el('article', {},
        el('strong', {}, item.date + ' · ' + kinds[item.kind] + ' · ' + grades[item.grade]),
        el('div', {class: 'row-meta'}, item.target ? titleOf(item.target) : null,
          item.minutes ? item.minutes + ' min' : null,
          previous ? t('距上次重寫天數', 'Days since last rewrite') + ' · ' + M.daysBetween(previous.date, item.date) : null),
        item.note ? el('p', {}, item.note) : null,
        item.kind === 'rewrite' && item.grade < 2
          ? button(kinds.correction, () => practice(id, false, item)) : null));
    }
    dialog(titleOf(id), tags(id), paragraph(labels[current.status]),
      current.due ? paragraph(t('下次複習', 'Next review') + ' · ' + current.due) : null,
      current.verified ? paragraph(t('最近一次驗證', 'Last verification') + ' · ' + current.verified) : null,
      actions(link(t('在 LeetCode 看題目 ↗', 'Open in LeetCode ↗'), lc(id), true),
        button(tracked ? t('開始複習', 'Start review') : t('開始練習', 'Start practice'), () => practice(id, !tracked))),
      form, tracked ? history : null);
  }

  function practice(id, fresh = false, correctionOf = null) {
    const record = state.records[id] ?? M.emptyRecord();
    const current = M.schedule(record);
    const initialKind = correctionOf ? 'correction' : 'rewrite';
    const kindsAvailable = fresh || current.status === 'known' || correctionOf
      ? [initialKind] : ['rewrite', 'recall', 'transfer'];
    const kind = select(kindsAvailable.map(key => [key, kinds[key]]), initialKind);
    const day = M.today();
    const date = el('input', {type: 'date', required: true, value: day, max: day,
      min: correctionOf?.date || current.lastRewrite || record.baseline?.date || ''});
    const hints = el('input', {type: 'checkbox'});
    const passed = el('input', {type: 'checkbox'});
    const fluent = el('input', {type: 'checkbox'});
    const minutes = el('input', {type: 'number', min: '1', max: '1440', step: '1'});
    const note = el('textarea');
    const preview = paragraph('');
    const error = errorLine();
    const targetPanel = el('div', {hidden: true});
    const prompt = paragraph('');
    const targetDisplay = el('div');
    const fluentField = field(t('完成流暢', 'Solved fluently'), fluent);
    fluentField.hidden = true;
    let target = null;
    const attempted = new Set(Object.values(state.records).flatMap(record =>
      record.history.filter(item => item.kind === 'transfer').map(item => item.target)));
    const targetPicker = picker(picked => {
      target = picked;
      targetDisplay.replaceChildren(paragraph(titleOf(target)), link(t('在 LeetCode 看題目 ↗', 'Open in LeetCode ↗'), lc(target), true));
    }, other => other !== id && !state.records[other] && !attempted.has(other));
    targetPanel.append(paragraph(t('選一題未做過、可用同一模式解的題目。', 'Pick an unseen problem that uses the same pattern.')),
      targetDisplay, targetPicker);
    const getGrade = () => !passed.checked ? 0 : hints.checked ? 1 : fluent.checked ? 3 : 2;

    function update() {
      const mode = kind.value;
      targetPanel.hidden = mode !== 'transfer';
      originalLink.hidden = mode === 'transfer' || mode === 'recall';
      fluentField.hidden = !passed.checked || hints.checked;
      prompt.textContent = mode === 'recall'
        ? t('先口頭說出解法、不變量和複雜度。', 'Recall the approach, invariant and complexity out loud.')
        : t('從空白編輯器開始。卡住時先試最小提示。', 'Start with a blank editor. If stuck, try the smallest hint first.');
      passed.parentElement.firstChild.textContent = mode === 'recall'
        ? t('完整說出解法', 'Recalled the full approach') : t('通過測試', 'Passed the tests');
      if (!date.value) {
        preview.textContent = grades[getGrade()];
        return;
      }
      const result = M.outcome(record, mode, getGrade(), date.value);
      let due = result.due || current.due;
      if (mode === 'recall' && current.due && due > current.due) due = current.due;
      if (fresh && getGrade() >= 2) due = M.plusDays(date.value, 1);
      preview.textContent = grades[getGrade()] + (due ? ' · ' + t('下次複習', 'Next review') + ' ' + due : '');
    }
    const form = el('form', {oninput: update, onsubmit: event => {
      event.preventDefault();
      const mode = kind.value;
      if (mode === 'transfer' && !target) {
        error.textContent = t('請選擇遷移題目。', 'Select a transfer problem.');
        return;
      }
      if (mode === 'rewrite' && record.history.some(item => item.kind === 'rewrite' && item.date === date.value)) {
        error.textContent = t('當天已有首次作答紀錄。訂正請從該筆紀錄另行登記。', 'A first attempt exists for this day. Log a correction from the history.');
        return;
      }
      const at = Date.now();
      const grade = getGrade();
      const item = {id: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
        date: date.value, at, kind: mode, grade, hints: hints.checked, passed: passed.checked,
        minutes: minutes.valueAsNumber || null, note: note.value, target: mode === 'transfer' ? target : null,
        ...M.outcome(record, mode, grade, date.value)};
      let baseline = record.baseline;
      if (fresh && grade >= 2) {
        baseline = {kind: 'learned', date: item.date, due: M.plusDays(item.date, 1), at};
        item.stage = 0;
        item.due = baseline.due;
      }
      const nextRecord = {...record, baseline, history: [item, ...record.history].sort((a, b) => M.compare(b, a))};
      const next = {...state, plan: planFor(state), records: {...state.records, [id]: nextRecord}};
      if (!save(next, error, t('已儲存練習紀錄。', 'Practice saved.'))) return;
      if (mode === 'rewrite' && grade < 2) {
        dialog(t('已記錄第一次作答', 'First attempt saved'),
          paragraph(t('訂正後關掉答案，再從空白編輯器重寫一次。', 'After correcting, close the solution and rewrite from a blank editor.')),
          actions(button(kinds.correction, () => practice(id, false, item), true),
            button(t('查看歷史', 'View history'), () => detail(id))));
      } else detail(id);
    }}, field(t('練習方式', 'Practice type'), kind), targetPanel, field(t('作答日期', 'Practice date'), date),
    field(t('使用提示', 'Used hints'), hints), field(t('通過測試', 'Passed the tests'), passed), fluentField,
    field(t('耗時（分鐘，選填）', 'Minutes (optional)'), minutes), field(t('卡住原因（選填）', 'What blocked you? (optional)'), note),
    preview, error, actions(submit(t('儲存本次紀錄', 'Save this attempt'))));
    const originalLink = link(t('在 LeetCode 看題目 ↗', 'Open in LeetCode ↗'), lc(id), true);
    update();
    dialog(titleOf(id), prompt, originalLink, form);
  }

  function backup() {
    const error = errorLine();
    const file = el('input', {type: 'file', accept: '.json,application/json', aria: {label: t('備份檔案', 'Backup file')}});
    const review = el('div', {role: 'status'});
    let selection = 0;
    file.addEventListener('change', async () => {
      const revision = ++selection;
      error.textContent = '';
      review.replaceChildren();
      if (!file.files[0]) return;
      try {
        const imported = M.validate(JSON.parse(await file.files[0].text()), catalog);
        if (revision !== selection) return;
        const entries = Object.entries(imported.records);
        const conflicts = entries.filter(([id]) => state.records[id]).length;
        const knownIds = new Set(Object.values(state.records).flatMap(record => record.history.map(item => item.id)));
        const attempts = entries.flatMap(([, record]) => record.history);
        const duplicates = attempts.filter(item => knownIds.has(item.id)).length;
        const apply = replace => {
          try {
            const next = M.validate(replace ? imported : M.merge(state, imported), catalog);
            if (save(next, error, t('已匯入複習資料。', 'Review data imported.'), replace)) $('dialog').close();
          } catch {
            error.textContent = t('備份紀錄有衝突，無法合併。', 'Backup records conflict and could not be merged.');
          }
        };
        review.append(paragraph(t('新增題目／同題紀錄', 'New problems / existing problems') + ' · ' +
          (entries.length - conflicts) + ' / ' + conflicts),
        paragraph(t('新增練習／重複練習', 'New attempts / duplicate attempts') + ' · ' + (attempts.length - duplicates) + ' / ' + duplicates),
        actions(damaged ? null : button(t('合併匯入', 'Merge backup'), () => apply(false), true),
          button(t('整份取代', 'Replace all'), () => {
            if (window.confirm(t('確定以備份取代本瀏覽器的全部複習資料？', 'Replace all review data in this browser with the backup?'))) apply(true);
          })));
      } catch {
        if (revision === selection) error.textContent = t('備份格式、版本或題目資料無效。', 'Invalid backup format, version or problem data.');
      }
    });
    const download = button(t('匯出 JSON', 'Export JSON'), () => {
      const blob = new Blob([JSON.stringify({...state, plan: planFor(state)}, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const anchor = el('a', {href: url, download: 'leetcode-review-' + M.today() + '.json'});
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    download.disabled = damaged;
    dialog(t('匯入／匯出', 'Import / export'),
      paragraph(t('用 JSON 檔把計畫與歷史搬到另一個瀏覽器。', 'Move your plan and history to another browser with a JSON file.')),
      actions(download), file, error, review);
  }

  $('header').append(link(t('← 回白板', '← Whiteboard'), 'index.html?lang=' + lang),
    el('h1', {}, document.title),
    button(t('＋ 記錄題目', '+ Log a problem'), () =>
      dialog(t('記錄題目', 'Log a problem'), picker(detail)), true),
    button(t('匯入／匯出', 'Import / export'), backup));
  $('sources').append(
    link('Grind 75', lists.grind.url, true), ' · ',
    ...sourceLabels.flatMap(list => [link(list.title, list.url, true), ' · ']),
    t('清單快照', 'List snapshot') + ' ' + lists.checkedOn);
  render();
  const incomingId = Number(query.get('problem'));
  if (catalog.has(incomingId)) detail(incomingId);
})();
