const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => zlib.gunzipSync(fs.readFileSync(path.join(root, 'public', name + '.gz'))).toString();
const source = read('cbt-course-data.js');
const course = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/cbt/question-banks.js'), 'utf8'), context);
const banks = context.window.CBTQuestionBanks;
let count = 0, questions = 0, screens = 0, rows = 0;
const included = new Set();
for (const group of course.groups) {
  const entries = banks.entries(course, group);
  rows += entries.length;
  const bank = banks.bank(course, group);
  const original = group.topics.map(id => course.topics.find(t => t.id === id));
  assert.deepEqual(Array.from(entries.filter(t => !t.questionBank), t => t.id), original.filter(t => t.sourceMode !== 'test').map(t => t.id));
  if (!bank) continue;
  count++;
  assert.equal(entries.filter(t => t.questionBank).length, 1);
  const parts = banks.parts(course, bank);
  const manifests = Array.from(parts, part => JSON.parse(read(part.manifest)));
  const before = JSON.stringify(manifests);
  const lesson = banks.compose(bank, manifests);
  assert.equal(JSON.stringify(manifests), before);
  const ids = new Set(lesson.scenes.map(s => s.id));
  assert.equal(ids.size, lesson.scenes.length);
  for (const section of lesson.sections) assert(ids.has(section.first));
  const old = new Map();
  parts.forEach((part, index) => {
    assert(!included.has(part.id)); included.add(part.id); questions++;
    const original = manifests[index];
    const converted = lesson.scenes.filter(s => s.bankQuestion.id === part.id);
    assert.equal(converted.length, original.scenes.length);
    assert.equal(converted[0].sourceStateScope, 'independent-root');
    converted.forEach((scene, number) => {
      const expected = {...original.scenes[number], id: part.id + '::' + original.scenes[number].id,
        sourceStateScope: number === 0 ? 'independent-root' : original.scenes[number].sourceStateScope};
      const actual = {...scene}; delete actual.bankQuestion;
      assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    });
    old.set(banks.storageKey(part.id), {index: original.scenes.length - 1,
      visited: original.scenes.map(s => s.id), completed: original.scenes.filter(s => s.exercise?.supported).map(s => s.id),
      comments: {[original.scenes[0].id]: 'Сохранённая заметка'}, settings: {audio: false}, finished: true});
  });
  const legacyBefore = JSON.stringify([...old]);
  const restored = banks.restore(bank, lesson, key => old.get(key));
  assert(restored.finished);
  assert.equal(restored.visited.length, lesson.scenes.length);
  assert.equal(restored.comments[lesson.scenes[0].id], 'Сохранённая заметка');
  assert.equal(restored.settings.audio, false);
  assert.equal(JSON.stringify([...old]), legacyBefore);
  assert(banks.progress(bank, key => old.get(key)).finished);
  screens += lesson.scenes.length;
}
assert.equal(count, 54);
assert.equal(questions, 267);
assert.equal(screens, 537);
assert.equal(rows, 419);
assert.equal(included.size, course.topics.filter(t => t.sourceMode === 'test').length);
console.log(JSON.stringify({banks: count, questions, screens, displayedRows: rows,
  allSourceQuestionsIncludedOnce: true, lessonsAndPracticePreserved: true,
  sourceScenesAndAnswersPreserved: true, legacyProgressAndNotesImported: true}));
