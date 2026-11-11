const ReviewModel = (() => {
  const intervals = [1, 2, 4, 7, 16, 30];
  const dayMs = 86400000;
  const format = (year, month, day) =>
    [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');

  function today() {
    const now = new Date();
    return format(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function plusDays(date, days) {
    const result = new Date(Date.parse(date + 'T00:00:00Z') + days * dayMs);
    return format(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
  }

  function daysBetween(start, end) {
    return (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / dayMs;
  }

  const difficulties = ['Easy', 'Medium', 'Hard'];
  const topicOrder = [
    'array', 'string', 'matrix', 'binary-search', 'graph', 'binary-search-tree',
    'binary-tree', 'hash-table', 'recursion', 'linked-list', 'stack', 'queue',
    'heap', 'trie', 'dynamic-programming', 'binary', 'math',
  ];
  const orderings = new Map([
    ['all_rounded', (a, b) => a.priority - b.priority],
    ['difficulty', (a, b) => difficulties.indexOf(a.difficulty) - difficulties.indexOf(b.difficulty)],
    ['topics', (a, b) => topicOrder.indexOf(a.topic) - topicOrder.indexOf(b.topic)],
  ]);
  const estimatedMinutes = minutes => 1.96 * minutes;

  function makePlan(settings, grind) {
    const weeklyBudget = settings.hours * 60;
    let remaining = 60 * (settings.hours * settings.weeks);
    const selected = [];
    for (const problem of [...grind].sort(orderings.get('all_rounded'))) {
      if (!settings.difficulties.includes(problem.difficulty)) continue;
      remaining -= estimatedMinutes(problem.minutes);
      if (remaining < 0) break;
      selected.push(problem);
    }

    const assignments = selected.length ? [[]] : [];
    let weekMinutes = 0;
    for (const problem of selected.sort(orderings.get(settings.order))) {
      const minutes = estimatedMinutes(problem.minutes);
      // Once the last week is reached, it receives all remaining selected problems.
      if (assignments.length < settings.weeks && weekMinutes + minutes > weeklyBudget) {
        assignments.push([]);
        weekMinutes = 0;
      }
      assignments.at(-1).push(problem.id);
      weekMinutes += minutes;
    }
    return {...settings, assignments};
  }

  function emptyRecord() {
    return {note: '', tags: [], noteAt: 0, baseline: null, history: []};
  }

  function compare(a, b) {
    return a.date.localeCompare(b.date) || a.at - b.at;
  }

  function schedule(record) {
    const history = record.history;
    const lastIndex = history.findIndex(item => item.kind === 'rewrite');
    const last = history[lastIndex];
    const baseline = record.baseline;
    const initial = last || baseline;
    let due = initial?.due ?? null;
    for (const item of last ? history.slice(0, lastIndex) : history) {
      if (!last && baseline && item.at < baseline.at) continue;
      if (item.kind === 'recall' && item.grade < 2 && (!due || item.due < due)) due = item.due;
    }
    const verified = history.find(item => item.kind === 'rewrite' && item.grade >= 2);
    return {
      due, stage: last?.stage ?? 0, verified: verified?.date ?? null,
      status: last ? (last.grade >= 2 ? 'verified' : 'weak') : baseline?.kind ?? 'new',
      lastRewrite: last?.date ?? null,
    };
  }

  function markPrior(state, ids, kind, date, at) {
    const records = {...state.records};
    const load = Array(7).fill(0);
    for (const record of Object.values(records)) {
      if (schedule(record).status !== 'known') continue;
      const day = daysBetween(date, record.baseline.due) - 1;
      if (day >= 0 && day < load.length) load[day]++;
    }
    for (const id of ids) {
      const record = records[id] ?? emptyRecord();
      if (record.baseline?.kind === kind || record.history.some(item => ['rewrite', 'recall'].includes(item.kind))) continue;
      const day = load.indexOf(Math.min(...load));
      if (kind === 'known') load[day]++;
      records[id] = {...record, baseline: {kind, date, at, due: kind === 'known' ? plusDays(date, day + 1) : date}};
    }
    return {...state, records};
  }

  function outcome(record, kind, grade, date) {
    const current = schedule(record);
    if (kind === 'rewrite') {
      const delta = [-current.stage, -1, 1, 2][grade];
      const stage = Math.min(intervals.length - 1, Math.max(0, current.stage + delta));
      return {stage, due: plusDays(date, intervals[stage])};
    }
    if (kind === 'recall' && grade < 2) return {stage: null, due: plusDays(date, 1)};
    return {stage: null, due: null};
  }

  function merge(local, incoming) {
    const records = {...local.records};
    for (const [id, other] of Object.entries(incoming.records)) {
      const current = records[id];
      if (!current) {
        records[id] = other;
        continue;
      }
      const notes = other.noteAt > current.noteAt ? other : current;
      const history = new Map(current.history.map(item => [item.id, item]));
      for (const item of other.history) {
        if (!history.has(item.id)) history.set(item.id, item);
      }
      records[id] = {
        note: notes.note, noteAt: notes.noteAt, tags: [...new Set([...current.tags, ...other.tags])],
        baseline: (other.baseline?.at ?? -1) > (current.baseline?.at ?? -1) ? other.baseline : current.baseline,
        history: [...history.values()].sort((a, b) => compare(b, a)),
      };
    }
    return {version: 1, plan: local.plan ?? incoming.plan, records};
  }

  function validate(data, catalog) {
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
    const timestamp = value => whole(value, 0, 8640000000000000);
    const date = value => typeof value === 'string' && /^[1-9]\d{3}-\d\d-\d\d$/.test(value) && plusDays(value, 0) === value;
    const id = value => Number.isSafeInteger(value) && catalog.has(value);
    const check = condition => { if (!condition) throw new Error('Invalid review backup'); };
    check(object(data) && data.version === 1 && object(data.records));
    if (data.plan !== null) {
      const plan = data.plan;
      check(object(plan) && date(plan.start) && plan.start <= '9998-12-31' && whole(plan.weeks, 1, 52) &&
        Number.isFinite(plan.hours) && plan.hours >= 0.25 && plan.hours <= 40 &&
        Array.isArray(plan.assignments) && plan.assignments.every(week => Array.isArray(week) && week.every(id)));
      if (plan.order === undefined) {
        check(plan.assignments.length === plan.weeks && Array.isArray(plan.overflow) && plan.overflow.every(id));
      } else {
        check(orderings.has(plan.order) && Array.isArray(plan.difficulties) &&
          plan.difficulties.every(value => difficulties.includes(value)) &&
          new Set(plan.difficulties).size === plan.difficulties.length &&
          plan.assignments.length <= plan.weeks);
      }
      const planned = plan.order === undefined ? plan.assignments.flat().concat(plan.overflow) : plan.assignments.flat();
      check(new Set(planned).size === planned.length);
    }
    const eventIds = new Set();
    for (const [key, record] of Object.entries(data.records)) {
      check(id(Number(key)) && String(Number(key)) === key && object(record) &&
        typeof record.note === 'string' && timestamp(record.noteAt) &&
        Array.isArray(record.tags) && record.tags.every(tag => typeof tag === 'string') &&
        Array.isArray(record.history));
      const baseline = record.baseline;
      check(baseline === null || (object(baseline) && ['weak', 'known', 'learned'].includes(baseline.kind) &&
        date(baseline.date) && timestamp(baseline.at) && date(baseline.due) && baseline.due >= baseline.date));
      for (const item of record.history) {
        check(object(item) && typeof item.id === 'string' && item.id.length > 0 && !eventIds.has(item.id) &&
          ['rewrite', 'recall', 'transfer', 'correction'].includes(item.kind) &&
          date(item.date) && timestamp(item.at) && whole(item.grade, 0, 3) &&
          typeof item.hints === 'boolean' && typeof item.passed === 'boolean' &&
          item.grade === (!item.passed ? 0 : item.hints ? 1 : Math.max(2, item.grade)) &&
          typeof item.note === 'string' && (item.minutes === null || whole(item.minutes, 1, 1440)));
        check(item.kind === 'transfer' ? id(item.target) && item.target !== Number(key) : item.target === null);
        if (item.kind === 'rewrite') {
          check(whole(item.stage, 0, intervals.length - 1) && item.due === plusDays(item.date, intervals[item.stage]));
        } else {
          check(item.stage === null && item.due === (item.kind === 'recall' && item.grade < 2 ? plusDays(item.date, 1) : null));
        }
        eventIds.add(item.id);
      }
      record.history.sort((a, b) => compare(b, a));
    }
    return data;
  }

  return {today, plusDays, daysBetween, difficulties, estimatedMinutes, makePlan,
    emptyRecord, compare, schedule, markPrior, outcome, merge, validate};
})();
