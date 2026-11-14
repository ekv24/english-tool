// Loaded before the locally bundled MathJax build for this book.
const bookWindow = /** @type {Window & {MathJax?: object}} */ (window);
bookWindow.MathJax = {
  options: {
    ignoreHtmlClass: '.*',
    processHtmlClass: 'math',
  },
  chtml: {
    matchFontHeight: false,
  },
};
