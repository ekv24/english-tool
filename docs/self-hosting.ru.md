# Своя установка English Tool

Это заметки о личной установке: читалка с русскими подсказками, собственная библиотека в `.local/` и доступ с iPhone и MacBook. Общее описание настроек на английском есть в [README](../README.md), формат материалов описан в [docs/materials.md](materials.md).

## Запуск на Mac

В папке проекта выполни `npm start` и открой [читалку](http://127.0.0.1:4173/). Сервер хранит словарь и прогресс чтения в `.local/reader-state/reader.sqlite`. Изменения без связи сохраняются в браузере и отправляются при восстановлении связи.

Чтобы подсказки были на русском, а библиотека показывала только свои материалы, задай переменные окружения:

```sh
export ENGLISH_TOOL_TARGET_LANGUAGE=ru
export ENGLISH_TOOL_EXAMPLES=0
export ENGLISH_TOOL_OPUS_MODEL=Xenova/opus-mt-en-ru
export ENGLISH_TOOL_OPUS_REVISION=e050376e960175e8ddc5cff85025dc8436cddd68
```

Глоссарии, викторины и метаданные своих материалов лежат в `materials/` рядом с кодом. Сами тексты, оригиналы, модель и база остаются в `.local/`. Каталог данных можно перенести переменной `ENGLISH_TOOL_DATA_DIR`, но скрипты подготовки пишут в `.local/`.

Для доступа с других устройств читалку открывают через закрытую сеть или прокси с HTTPS и паролем. `scripts/private-reader-proxy.mjs` проверяет пароль из `.local/reader-password` и передаёт запросы на порт 4173. Чтобы перенести старые слова и позиции, один раз открой читалку в каждом браузере по тому адресу, по которому раньше читал.

В **Vocabulary → Review** читалка предлагает до двадцати сохранённых выражений, новых из них до десяти. Вспомни значение, открой ответ и выбери **Remembered** или **Again**. **Continue review** открывает следующую карточку на любом устройстве. После возвращения связи открой Vocabulary на устройстве, где отвечал офлайн, чтобы отправить сохранённый ответ.

Для новой копии проекта, на Mac с Apple Silicon, ARM64-версией Node.js 24 или новее и доступом к интернету:

```sh
npm ci --ignore-scripts
npx playwright-core install --only-shell chromium
npm run prepare:articles
npm run prepare:book
npm run prepare:model
npm start
```

`npm run prepare:model` скачивает модель, указанную в `ENGLISH_TOOL_OPUS_MODEL`, поэтому переменные выше нужно задать до этой команды.

Подготовка сохраняет исходный HTML в `.local/originals/`, а HTML для читалки и изображения в `.local/materials/`. Команда `npm run prepare:articles` загружает две статьи Anthropic. Статью Феликса Ризеберга можно добавить командой `node scripts/prepare-article.mjs how-to-be-more-ambitious`. После скачивания модели перевод работает локально. Технические термины из словаря статьи имеют подготовленные переводы и пояснения. Для остальных выделений используется OPUS-MT. При нажатии «Translate sentence» для них показывается машинный перевод предложения.

## Перевод предложений через TranslateGemma

Для перевода предложений используется локальная TranslateGemma 4B с подсказками из глоссария открытого материала. Для такого запуска нужна Ollama с моделью `translategemma:4b`. Если Ollama слушает нестандартный порт, укажи его адрес:

```sh
export ENGLISH_TOOL_OLLAMA_MODEL=translategemma:4b
export ENGLISH_TOOL_OLLAMA_URL=http://127.0.0.1:11438
```

Прежнее имя переменной `ENGLISH_TOOL_SENTENCE_MODEL` тоже работает. Без `ENGLISH_TOOL_OLLAMA_URL` читалка обращается к `http://127.0.0.1:11434`. Если модель не ответила за 8 секунд или недоступна, предложение переводит OPUS-MT.

## Учебник

`npm run prepare:book` скачивает и проверяет закреплённую версию официального веб-издания, сохраняет оригиналы в `.local/originals/causal-inference/` и готовит читалку в `.local/books/causal-inference/`. В библиотеке доступны введение Matheus Facure Alves, 25 глав и 5 материалов приложения. Формулы отображает локальная копия MathJax. На экранном графике можно нажать на увеличение и открыть оригинал. Оригинальные иллюстрации, лицензия автора и данные остаются в локальной копии. Комикс Confidence Interval и другие иллюстрации сторонних авторов сохраняют свои условия использования. [Оригинал учебника](https://matheusfacure.github.io/python-causality-handbook/landing-page.html) · [Лицензия xkcd](https://xkcd.com/license.html).

Описание, первая глава для кнопки **Start chapter 1**, ссылка на лицензию MIT и включение MathJax для учебника заданы в `materials/causal-inference.json`.

### Пересборка графиков из данных

Читалка использует исходные SVG для оформления причинных схем и перерисовывает
учебные схемы, геометрию которых можно сверить с оригиналом. Для графиков из
ноутбуков отдельно проверяется воспроизводимость опубликованных данных.
Если опубликованный график нельзя воспроизвести из данных, сборка создаёт
SVG-контуры по исходному изображению в новой палитре. Это сохраняет положение
кривых, точек и подписей вместе с точностью оригинала. Таким способом можно
увеличить сам график, однако мелкие подписи из исходного растра останутся
ограничены его разрешением. Кнопка **Original** показывает сохранённый источник.
В поле `figureMethods` файла `manifest.json` указан способ построения каждой
технической фигуры.
Для трёх графиков T-learner и X-learner использованы координаты
векторного рисунка из [статьи Künzel и соавторов](https://pmc.ncbi.nlm.nih.gov/articles/PMC6410831/#fig01).

Для воспроизведения SVG из данных нужен CPython 3.9 и зависимости из
`scripts/book-redraw-requirements.txt`. Скачай и распакуй исходный репозиторий
на [закреплённом коммите](https://github.com/matheusfacure/python-causality-handbook/tree/4df1445987d3b6f9824d508863a1a2f0a503e888).
В примере `book_source` указывает на распакованную папку
`causal-inference-for-the-brave-and-true` с `data/` и `sc.py`.
На macOS для LightGBM может потребоваться OpenMP. Проверенные скрипты
сверяют SHA-256 ноутбуков и входных файлов, прежде чем выполняют ячейки.
Переменная `book_source` должна быть задана перед командами ниже.

```sh
python3.9 -m venv .local/book-plot-env
.local/book-plot-env/bin/python -m pip install -r scripts/book-redraw-requirements.txt
book_python=.local/book-plot-env/bin/python
book_originals=.local/originals/causal-inference
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 LOKY_MAX_CPU_COUNT=1
"$book_python" scripts/redraw-book-plots.py "$book_originals" "$book_source/data" .local/redrawn-book-plots
"$book_python" scripts/redraw-book-part-one.py "$book_originals" "$book_source/data" .local/redrawn-book-part-one
"$book_python" scripts/redraw-book-part-two.py "$book_originals" .local/redrawn-book-part-two --source-data "$book_source"
"$book_python" scripts/redraw-book-sdid.py "$book_originals" "$book_source" .local/redrawn-book-sdid --include-intervals
npm run prepare:book
```

Скрипты пишут результаты в новые каталоги. При повторной генерации сначала
задай новый выходной каталог и проверь его `manifest.json`. `prepare:book`
подхватывает SVG из указанных выше каталогов.

## Zero to One

Из предоставленного английского PDF готовятся предисловие, 14 глав,
заключение и справочные разделы. **Original** открывает PDF, а нажатие на
технический рисунок показывает рядом оформленную версию и исходное изображение.
Для повторной подготовки из этой же копии PDF нужны Python 3 и Poppler
(`pdftohtml` и `pdfimages`).

```sh
python3 scripts/prepare-zero-to-one.py '/path/to/Zero to One.pdf'
```

Если Poppler установлен отдельно, укажи каталог с его программами через
`--poppler-bin`. Неизменённый PDF и HTML хранятся в `.local/`.

## Проверка

```sh
npm run check
READER_SCREENSHOTS=.local/screenshots npm test
npm run test:browser
```

Тесты своей библиотеки в `npm test` используют подготовленные материалы и модель из `.local/` и сами задают русский язык и модель OPUS-MT. Без этих данных они пропускаются. Скриншоты сохраняются в папке, указанной в `READER_SCREENSHOTS`. Без этой переменной тесты проходят без записи изображений. `npm run test:browser` проверяет демонстрационные материалы и не трогает `.local/`.

## Визуальные референсы

[Claude Design System от bergside](https://github.com/bergside/awesome-design-skills/tree/main/skills/claude) задаёт тёплые нейтрали, шкалу отступов и компактную навигацию. [Референс ItamarZand88](https://github.com/ItamarZand88/design-skills/blob/main/design-md/claude/DESIGN.md) описывает читаемую пару serif и sans и лёгкое обрамление всплывающих элементов. [Brand guidelines Anthropic](https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md) задаёт базовые цвета и Lora для текста. В читалке Lora используется для статьи, Geist для элементов управления. Для книги сверял оформление с [публикациями Anthropic Engineering](https://www.anthropic.com/engineering) и [редакционной вёрсткой статьи о harness design](https://www.anthropic.com/research/harness-design-long-running-apps).

Для подготовки новых материалов в Codex доступен [проектный навык](../.agents/skills/prepare-english-tool-material/SKILL.md).
