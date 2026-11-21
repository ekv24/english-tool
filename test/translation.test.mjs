import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInContext } from '../translation.mjs';

// Real TranslateGemma answers to «"word", as used in the sentence: "…"».
test('keeps an in-context translation only when the sentence translation confirms it', () => {
  const picasso = 'Many art historians believe that this event launched Picasso into his Blue Period of painting.';
  assert.equal(checkInContext('committed', 'Carlos Casagemas committed suicide.',
    '«покончил с собой», как используется в предложении: «Например, в 1901 году друг Пикассо Карлос Касагемас покончил с собой»'),
  'покончил с собой');
  assert.equal(checkInContext('takeaways', 'Our biggest takeaways:',
    '"Основные выводы", как используется в предложении: "Наши основные выводы:"'), 'основные выводы');
  // The quoted word drifted to a neighbour that the sentence translation does not contain.
  assert.equal(checkInContext('interrupt', 'Bereavement can interrupt flow and alter mood.',
    '"прерывать", как используется в предложении: «Грусть может нарушить ход мыслей и изменить настроение»'), null);
  // An untranslated answer, or one without the sentence to check against, is not used.
  assert.equal(checkInContext('launched', picasso, '"launched", as used in the sentence'), null);
  assert.equal(checkInContext('launched', picasso, 'историки искусства'), null);
});
