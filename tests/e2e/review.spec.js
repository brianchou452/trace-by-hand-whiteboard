const {expect, test} = require('@playwright/test');
const {readFile} = require('node:fs/promises');
const plans = require('./fixtures/grind75.json');

const reviewUrl = '/review.html?lang=en';
const storageKey = 'drycanvas-review-v1';
const defaultPlan = plans.mediumAllRounded;
const firstProblem = '#53 Maximum Subarray';
const fixtureDate = new Date('2026-11-11T12:00:00+08:00');

const button = (scope, name) => scope.getByRole('button', {name, exact: true});
const label = (scope, name) => scope.getByLabel(name, {exact: true});
const main = page => page.locator('#view');
const modal = page => page.getByRole('dialog');
const weeks = scope => scope.locator('details.panel');
const problemRow = (scope, title) => scope.locator('.row').filter({has: scope.page().getByText(title, {exact: true})});

async function openPlan(page) {
  await button(page, 'Study plan').click();
  return main(page);
}

async function expectSchedule(scope, assignments) {
  const groups = weeks(scope);
  await expect(groups).toHaveCount(assignments.length);
  for (const [index, expectedTitles] of assignments.entries()) {
    const group = groups.nth(index);
    await expect(group.locator('summary')).toContainText(new RegExp('^Week ' + (index + 1) + ' ·'));
    const titles = await group.locator('.row strong').allTextContents();
    expect(titles.map(title => title.replace(/^#\d+ /, ''))).toEqual(expectedTitles);
  }
}

async function changeSettings(plan, settings) {
  await label(plan, 'Weeks').fill(String(settings.weeks));
  await label(plan, 'Hours per week').fill(String(settings.hours));
  await label(plan, 'Order').selectOption(settings.order);
  for (const difficulty of ['Easy', 'Medium', 'Hard']) {
    await label(plan, difficulty).setChecked(settings.difficulties.includes(difficulty));
  }
}

async function learnFirstProblem(page) {
  await button(problemRow(main(page), firstProblem), 'Start practice').click();
  const dialog = modal(page);
  await label(dialog, 'Passed the tests').check();
  await label(dialog, 'Minutes (optional)').fill('24');
  await label(dialog, 'What blocked you? (optional)').fill('Track the best sum ending here.');
  await button(dialog, 'Save this attempt').click();
  await expect(dialog.getByText('Next review · 2026-11-12', {exact: true})).toBeVisible();
  await button(dialog, 'Close').click();
}

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(fixtureDate);
});

test('default plan matches every official Medium question in all nine weeks', async ({page}) => {
  await page.goto(reviewUrl);
  const plan = await openPlan(page);
  await expect(label(plan, 'Start date')).toHaveValue('2026-11-11');
  await expect(label(plan, 'Weeks')).toHaveValue('9');
  await expect(label(plan, 'Hours per week')).toHaveValue('10');
  await expect(label(plan, 'Order')).toHaveValue('all_rounded');
  await expect(label(plan, 'Medium')).toBeChecked();
  await expect(label(plan, 'Easy')).not.toBeChecked();
  await expect(label(plan, 'Hard')).not.toBeChecked();
  await expectSchedule(plan, defaultPlan.assignments);
  await expect(weeks(plan).last().locator('summary')).toContainText('706 min · 0/13');

  const fifth = weeks(plan).nth(4);
  await fifth.locator('summary').click();
  await button(problemRow(fifth, '#1730 Shortest Path to Get Food'), 'Start practice').click();
  await expect(modal(page).getByRole('link', {name: 'Open in LeetCode ↗'}))
    .toHaveAttribute('href', 'https://leetcode.com/problems/shortest-path-to-get-food/');
});

for (const [name, settings] of [
  ['mixed difficulties ordered by topic', plans.mixedTopics],
  ['mixed difficulties ordered by difficulty', plans.mixedDifficulty],
  ['a first question longer than one weekly budget', plans.firstQuestionExceedsWeeklyBudget],
]) {
  test('preview and save the official schedule for ' + name, async ({page}) => {
    await page.goto(reviewUrl);
    const plan = await openPlan(page);
    await changeSettings(plan, settings);
    await button(plan, 'Preview changes').click();
    await expectSchedule(modal(page), settings.assignments);

    await button(modal(page), 'Close').click();
    await expectSchedule(plan, defaultPlan.assignments);

    await button(plan, 'Preview changes').click();
    await button(modal(page), 'Apply plan').click();
    await expect(modal(page)).toBeHidden();
    await expectSchedule(plan, settings.assignments);

    await page.reload();
    await openPlan(page);
    await expect(label(plan, 'Weeks')).toHaveValue(String(settings.weeks));
    await expect(label(plan, 'Hours per week')).toHaveValue(String(settings.hours));
    await expect(label(plan, 'Order')).toHaveValue(settings.order);
    await expectSchedule(plan, settings.assignments);
  });
}

test('a plan with no matching questions shows an empty state after reload', async ({page}) => {
  await page.goto(reviewUrl);
  const plan = await openPlan(page);
  await label(plan, 'Medium').uncheck();
  await button(plan, 'Preview changes').click();
  const empty = 'No problems fit these settings.';
  await expect(modal(page).getByText(empty, {exact: true})).toBeVisible();
  await expect(weeks(modal(page))).toHaveCount(0);
  await button(modal(page), 'Apply plan').click();
  await page.reload();
  await openPlan(page);
  await expect(plan.getByText(empty, {exact: true})).toBeVisible();
  await expect(weeks(plan)).toHaveCount(0);
});

test('a stale tab cannot overwrite a plan saved by another tab', async ({page, context}) => {
  await page.goto(reviewUrl);
  const stalePlan = await openPlan(page);
  await button(stalePlan, 'Preview changes').click();

  const other = await context.newPage();
  await other.clock.setFixedTime(fixtureDate);
  await other.goto(reviewUrl);
  const otherPlan = await openPlan(other);
  await changeSettings(otherPlan, plans.mixedTopics);
  await button(otherPlan, 'Preview changes').click();
  await button(modal(other), 'Apply plan').click();

  await button(modal(page), 'Apply plan').click();
  await expect(modal(page).getByRole('alert')).toHaveText(
    'Another tab updated the data. Keep your input and reload before saving.',
  );
  await page.reload();
  await expectSchedule(await openPlan(page), plans.mixedTopics.assignments);
});

test('a saved legacy plan is rebuilt while its date and practice record survive', async ({page}) => {
  const legacy = {
    version: 1,
    plan: {
      start: '2026-11-10', weeks: 9, hours: 10,
      assignments: [[53], [1], [], [], [], [], [], [], []], overflow: [],
    },
    records: {
      53: {
        note: 'Keep the old note', tags: ['Kadane'], noteAt: 0,
        baseline: {kind: 'learned', date: '2026-11-10', at: 0, due: '2026-11-11'}, history: [],
      },
    },
  };
  await page.addInitScript(({key, data}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, {key: storageKey, data: legacy});
  await page.goto(reviewUrl);
  const plan = await openPlan(page);
  await expect(label(plan, 'Start date')).toHaveValue('2026-11-10');
  await expectSchedule(plan, defaultPlan.assignments);
  await expect(weeks(plan).first().locator('summary')).toContainText('1/11');
  await button(problemRow(plan, firstProblem), 'Details').click();
  await expect(label(modal(page), 'Key ideas and notes')).toHaveValue('Keep the old note');
  await expect(label(modal(page), 'Pattern tags (comma separated)')).toHaveValue('Kadane');
  await button(modal(page), 'Close').click();

  await button(plan, 'Preview changes').click();
  await button(modal(page), 'Apply plan').click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.records).toEqual(legacy.records);
  expect(saved.plan).toMatchObject({start: legacy.plan.start, weeks: 9, hours: 10, order: 'all_rounded'});
});

test('learning a planned problem updates progress, history and the review queue', async ({page}) => {
  await page.goto(reviewUrl);
  await learnFirstProblem(page);
  await expect(problemRow(main(page), firstProblem)).toHaveCount(0);

  const plan = await openPlan(page);
  await expectSchedule(plan, defaultPlan.assignments);
  await expect(weeks(plan).first().locator('summary')).toContainText('1/11');
  await button(problemRow(plan, firstProblem), 'Details').click();
  await expect(modal(page).getByText('Track the best sum ending here.', {exact: true})).toBeVisible();
  await expect(modal(page).getByText('24 min', {exact: true})).toBeVisible();
  await button(modal(page), 'Close').click();

  await button(page, 'Review schedule').click();
  await expect(problemRow(main(page), firstProblem).getByText('2026-11-12', {exact: true})).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00+08:00'));
  await page.reload();
  const row = problemRow(main(page), firstProblem);
  await button(row, 'Start review').click();
  await label(modal(page), 'Passed the tests').check();
  await label(modal(page), 'Solved fluently').check();
  await button(modal(page), 'Save this attempt').click();
  await expect(modal(page).getByText('Next review · 2026-11-16', {exact: true})).toBeVisible();
});

test('a same-day correction preserves the first attempt and its review date', async ({page}) => {
  await page.goto(reviewUrl);
  await button(problemRow(main(page), firstProblem), 'Start practice').click();
  const dialog = modal(page);
  await button(dialog, 'Save this attempt').click();
  await expect(dialog.getByRole('heading', {name: 'First attempt saved'})).toBeVisible();
  await button(dialog, 'Correction rewrite').click();
  await label(dialog, 'Passed the tests').check();
  await button(dialog, 'Save this attempt').click();

  await expect(dialog.getByText('Next review · 2026-11-12', {exact: true})).toBeVisible();
  const history = dialog.locator('.history article strong');
  await expect(history).toHaveCount(2);
  await expect(history.filter({hasText: 'Full rewrite · Forgot or unfinished'})).toHaveCount(1);
  await expect(history.filter({hasText: 'Correction rewrite · Independent with difficulty'})).toHaveCount(1);
});

test('inventory marks a planned problem without removing it from the schedule', async ({page}) => {
  await page.goto(reviewUrl);
  const plan = await openPlan(page);
  await button(plan, 'Mark previously attempted problems').click();
  const dialog = modal(page);
  await label(dialog, 'Search by number or title').fill('Maximum Subarray');
  await label(dialog, firstProblem).check();
  await expect(dialog.getByText('Selected · 1', {exact: true})).toBeVisible();
  await button(problemRow(dialog, firstProblem), 'Attempted · I can solve it').click();
  await button(dialog, 'Close').click();
  await expectSchedule(plan, defaultPlan.assignments);
  const row = problemRow(plan, firstProblem);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Self-rated · check pending');
  await button(page, 'Review schedule').click();
  await expect(button(problemRow(main(page), firstProblem), 'Start blind rewrite')).toBeVisible();
});

test('a JSON backup restores the plan and practice history in a fresh browser context', async ({page, browser, baseURL}) => {
  await page.goto(reviewUrl);
  await learnFirstProblem(page);
  await button(page, 'Import / export').click();
  const downloadEvent = page.waitForEvent('download');
  await button(modal(page), 'Export JSON').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('leetcode-review-2026-11-11.json');

  const restored = await browser.newContext({baseURL, timezoneId: 'Asia/Taipei'});
  try {
    const imported = await restored.newPage();
    await imported.clock.setFixedTime(fixtureDate);
    await imported.goto(reviewUrl);
    await button(imported, 'Import / export').click();
    await label(modal(imported), 'Backup file').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: await readFile(await download.path()),
    });
    await expect(modal(imported).getByText('New attempts / duplicate attempts · 1 / 0', {exact: true})).toBeVisible();
    await button(modal(imported), 'Merge backup').click();

    const plan = await openPlan(imported);
    await expectSchedule(plan, defaultPlan.assignments);
    await expect(weeks(plan).first().locator('summary')).toContainText('1/11');
    await button(problemRow(plan, firstProblem), 'Details').click();
    await expect(modal(imported).getByText('Track the best sum ending here.', {exact: true})).toBeVisible();
  } finally {
    await restored.close();
  }
});

test('an invalid JSON backup reports an error and leaves the plan available', async ({page}) => {
  await page.goto(reviewUrl);
  await button(page, 'Import / export').click();
  await label(modal(page), 'Backup file').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}'),
  });
  await expect(modal(page).getByRole('alert')).toHaveText('Invalid backup format, version or problem data.');
  await expect(button(modal(page), 'Merge backup')).toHaveCount(0);
  await button(modal(page), 'Close').click();
  await expectSchedule(await openPlan(page), defaultPlan.assignments);
});

test('review navigation works from the whiteboard and keeps the selected language', async ({page}) => {
  await page.goto('/index.html?lang=zh-TW');
  await page.locator('#reviewLink').click();
  await expect(page).toHaveURL(/\/review\.html\?lang=zh-TW$/);
  await button(page, '學習計畫').click();
  await expect(weeks(main(page))).toHaveCount(9);
  await expect(label(main(page), '每週時數')).toHaveValue('10');
  await page.getByRole('link', {name: '← 回白板', exact: true}).click();
  await expect(page).toHaveURL(/\/index\.html\?lang=zh-TW$/);
});
