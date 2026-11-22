/** @param {string} value */
export function escape(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

/** @param {string} field @param {[value:string, label:string][]} options */
function feedbackChoices(field, options) {
  return options.map(([value, label]) =>
    '<button class="feedback-choice" type="button" data-' + field + '="' + value + '" aria-pressed="false">' + label + '</button>').join('');
}

/**
 * The reader's verdict on a material, shown after the text. It records interest and the difficulty
 * of the English separately: for a learner, a hard text is not the same as a dull one.
 * @param {string} material an article or book id
 */
export function feedbackCard(material) {
  return '<section class="feedback" data-feedback="' + escape(material) + '" aria-labelledby="feedback-heading" hidden>' +
    '<div class="feedback-head"><h2 id="feedback-heading">Your take</h2><p>It helps choose what you read next.</p></div>' +
    '<div class="feedback-row"><span class="feedback-label" id="feedback-interest">Interest</span>' +
    '<div class="feedback-choices" role="group" aria-labelledby="feedback-interest">' +
    feedbackChoices('interest', [['more', 'More like this'], ['fine', 'It was fine'], ['less', 'Not for me']]) + '</div></div>' +
    '<div class="feedback-row"><span class="feedback-label" id="feedback-level">English</span>' +
    '<div class="feedback-choices" role="group" aria-labelledby="feedback-level">' +
    feedbackChoices('level', [['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']]) + '</div></div>' +
    '<details class="feedback-note"><summary>Add a note</summary>' +
    '<label for="feedback-note">What stood out, or what you would like to read next</label>' +
    '<textarea id="feedback-note" rows="3" maxlength="4000"></textarea></details>' +
    '<p class="feedback-status" role="status"></p></section>';
}
