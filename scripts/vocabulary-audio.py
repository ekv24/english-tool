"""Speaks the day's expressions and joins them into one recording that plays in a loop.

Reads {"cards": [{"key", "lemma", "text", "translation", "sentence"}]} from stdin and writes
mix.json and <version>.mp3 into the given directory. See docs/agents/vocabulary-audio.md.
"""
import argparse
import difflib
import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--design-voice', action='store_true', help='create voice.wav, the Russian voice, once')
parser.add_argument('--download', action='store_true', help='allow downloading the models')
options = parser.parse_args()
directory = options.directory.resolve()
directory.mkdir(parents=True, exist_ok=True)
os.environ['HF_HOME'] = str(directory / 'models')
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
if not options.download and not options.design_voice:
    # The daily run must not depend on the network or on a model that changed upstream.
    os.environ['HF_HUB_OFFLINE'] = '1'

import lameenc
import mlx.core as mx
import numpy as np
import soundfile as sf

RATE = 24000
ENGLISH_VOICE = 'af_heart'
ENGLISH_MODEL = 'mlx-community/Kokoro-82M-bf16'
RUSSIAN_MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit'
DESIGN_MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit'
LISTENER_MODEL = 'mlx-community/whisper-large-v3-turbo-asr-fp16'
VOICE_TEXT = 'Доброе утро! Давай повторим твои слова. Сначала послушай, попробуй вспомнить перевод, а потом я скажу ответ.'
VOICE_DESIGN = ('Тёплый, мягкий голос молодой женщины около тридцати лет, носительница русского языка, московское произношение '
                'без акцента, спокойный темп, бархатный тембр, очень чёткая дикция, студийный микрофон.')
# The word, a pause to recall it, the translation, the word again. Seconds.
RECALL, BEFORE_REPEAT, BETWEEN_CARDS = 2.5, 0.6, 1.4
TARGET_SECONDS = 30 * 60
ATTEMPTS = 6
# Russian infinitives and reflexive verbs; a few nouns match too, which rarely changes the sound.
VERB = re.compile(r'(?:[аяиеуоы]ть|ться|тся|ти|чь)$')
clips = directory / 'clips'
clips.mkdir(exist_ok=True)
voice = directory / 'voice.wav'


def say(message):
    print(message, file=sys.stderr, flush=True)


def load(name, kind='tts'):
    if kind == 'tts':
        from mlx_audio.tts.utils import load_model
    else:
        from mlx_audio.stt.utils import load_model
    return load_model(name)


def samples(results):
    return np.concatenate([np.array(result.audio).reshape(-1) for result in results]).astype(np.float32)


def design_voice():
    model = load(DESIGN_MODEL)
    mx.random.seed(5)
    audio = samples(model.generate_voice_design(text=VOICE_TEXT, language='Russian', instruct=VOICE_DESIGN))
    sf.write(voice, audio, RATE)
    say(f'Wrote {voice}')


def clip_path(language, *parts):
    digest = hashlib.sha256('\0'.join(parts).encode()).hexdigest()[:20]
    return clips / f'{language}-{digest}.wav'


def tidy(audio):
    """Trims silence, softens the edges and brings every clip to the same loudness."""
    loud = np.where(np.abs(audio) > 0.012)[0]
    if not len(loud):
        return None
    audio = audio[max(0, loud[0] - RATE // 20):loud[-1] + RATE // 10].copy()
    edge = min(RATE // 50, len(audio) // 4)
    ramp = np.linspace(0, 1, edge, dtype=np.float32)
    audio[:edge] *= ramp
    audio[-edge:] *= ramp[::-1]
    level = np.sqrt(np.mean(audio[np.abs(audio) > 0.02] ** 2)) if (np.abs(audio) > 0.02).any() else 0
    return np.clip(audio * (0.085 / level), -0.95, 0.95) if level else None


def store(path, audio):
    partial = path.with_suffix('.part.wav')
    sf.write(partial, audio, RATE)
    partial.rename(path)


class English:
    """Kokoro reading dictionary transcriptions; the sentence decides between two readings of one spelling."""

    def __init__(self):
        from misaki import en, espeak
        self.fallback = espeak.EspeakFallback(british=False)
        self.g2p = en.G2P(trf=False, british=False, fallback=self.fallback, unk='')
        self.model = None

    def phonemes(self, card):
        lemma, text = card['lemma'], card['text']
        sentence = self.g2p.nlp(card['sentence'])
        words = lambda value: [token.text.lower() for token in self.g2p.nlp.tokenizer(value)]
        selection = words(text)
        spans = [sentence[i:i + len(selection)] for i in range(len(sentence)) if words(sentence[i:i + len(selection)].text) == selection]
        tags = {span[0].tag_ for span in spans}
        tag = tags.pop() if len(tags) == 1 else ''
        carrier = ''
        # "to record" and "the record" are read differently. The tagger is sometimes wrong, and the
        # checked translation says whether the headword is a verb.
        if VERB.search(re.split(r'[ ,]', card['translation'])[0]):
            carrier = 'it ' if tag in ('VBZ', 'NNS') and lemma.lower() == text.lower() else 'to '
        elif len(selection) == 1 and tag in ('NN', 'NNS', 'VB', 'VBP', 'VBZ'):
            carrier = 'the '
        _, tokens = self.g2p(carrier + lemma)
        spoken = tokens[1:] if carrier else tokens
        phonemes = ''.join((token.phonemes or '') + token.whitespace for token in spoken).strip()
        # "though" is unstressed inside a sentence, but here it is the whole utterance.
        return phonemes if 'ˈ' in phonemes else phonemes.replace('ˌ', 'ˈ', 1)

    def clip(self, card):
        phonemes = self.phonemes(card)
        if not phonemes:
            say(f'No pronunciation: {card["lemma"]}')
            return None
        path = clip_path('en', ENGLISH_VOICE, phonemes)
        if not path.exists():
            self.model = self.model or load(ENGLISH_MODEL)
            pipeline = self.model._get_pipeline('a')
            results = list(pipeline.generate_from_tokens(phonemes + '.', ENGLISH_VOICE, speed=0.9))
            audio = tidy(samples(results))
            if audio is None or not 0.2 < len(audio) / RATE < 0.8 + 0.3 * len(card['lemma']):
                say(f'Unusable English clip: {card["lemma"]}')
                return None
            store(path, audio)
            say(f'en {card["lemma"]} /{phonemes}/ {len(audio) / RATE:.1f} s')
        return path


class Russian:
    """Qwen3-TTS in the designed voice. It improvises, so another model listens to every clip."""

    def __init__(self):
        self.model = self.listener = None

    @staticmethod
    def plain(text):
        return re.sub(r'[^а-яa-z0-9]+', ' ', text.lower().replace('ё', 'е')).strip()

    def clip(self, card):
        text = card['translation']
        path = clip_path('ru', hashlib.sha256(voice.read_bytes()).hexdigest(), text)
        if path.exists():
            return path
        self.model = self.model or load(RUSSIAN_MODEL)
        self.listener = self.listener or load(LISTENER_MODEL, 'stt')
        best = (0.0, None, '')
        for seed in range(ATTEMPTS):
            mx.random.seed(11 + seed)
            results = self.model.generate(text=text[0].upper() + text[1:] + '.', lang_code='Russian', ref_audio=str(voice),
                                          ref_text=VOICE_TEXT, temperature=0.6, max_tokens=150)
            audio = tidy(samples(results))
            if audio is None or not 0.25 < len(audio) / RATE < 1.5 + 0.16 * len(text):
                continue
            store(clips / 'candidate.wav', audio)
            heard = self.listener.generate(str(clips / 'candidate.wav'), language='ru', verbose=False).text
            score = difflib.SequenceMatcher(None, self.plain(text), self.plain(heard)).ratio()
            if score > best[0]:
                best = (score, audio, heard.strip())
            if score == 1:
                break
        score, audio, heard = best
        # Endings and unstressed vowels are easily misheard; anything further off is not used.
        if audio is None or score < 0.85:
            say(f'Unusable Russian clip: {text} (heard: {heard}, {score:.2f})')
            return None
        store(path, audio)
        say(f'ru {text} {len(audio) / RATE:.1f} s' + ('' if score == 1 else f' (heard: {heard}, {score:.2f})'))
        return path


def silence(seconds):
    return np.zeros(int(RATE * seconds), np.float32)


def read(path):
    return sf.read(path, dtype='float32')[0]


def mix(spoken):
    """Repeats the set in a new order each time until the recording is long enough."""
    lengths = [2 * len(en) + len(ru) for _, en, ru in spoken]
    round_seconds = sum(lengths) / RATE + len(spoken) * (RECALL + BEFORE_REPEAT + BETWEEN_CARDS)
    parts, segments, at, previous = [], [], 0, None
    for _ in range(max(1, round(TARGET_SECONDS / round_seconds))):
        order = random.sample(range(len(spoken)), len(spoken))
        if order[0] == previous and len(order) > 1:
            order[0], order[-1] = order[-1], order[0]
        previous = order[-1]
        for index in order:
            _, en, ru = spoken[index]
            pieces = [en, silence(RECALL), ru, silence(BEFORE_REPEAT), en, silence(BETWEEN_CARDS)]
            length = sum(map(len, pieces))
            answer = at + len(pieces[0]) + len(pieces[1])
            segments.append([round(at / RATE, 2), round(answer / RATE, 2), round((at + length) / RATE, 2), index])
            parts += pieces
            at += length
    audio = np.concatenate(parts)
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(56)
    encoder.set_in_sample_rate(RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoder.silence()
    data = encoder.encode((audio * 32767).astype(np.int16).tobytes()) + encoder.flush()
    version = hashlib.sha256(data).hexdigest()[:16]
    (directory / f'{version}.mp3').write_bytes(data)
    manifest = {
        'version': version, 'seconds': round(at / RATE, 2), 'segments': segments,
        'cards': [{key: card[key] for key in ('key', 'lemma', 'translation')} for card, _, _ in spoken],
    }
    partial = directory / 'mix.json.part'
    partial.write_text(json.dumps(manifest, ensure_ascii=False))
    partial.rename(directory / 'mix.json')
    # A page opened yesterday may still ask for the previous recording.
    for old in directory.glob('*.mp3'):
        if old.stem != version and time.time() - old.stat().st_mtime > 2 * 86400:
            old.unlink()
    say(f'{len(spoken)} expressions, {at / RATE / 60:.1f} min, {len(data) // 1024} KB, {version}')


if options.design_voice:
    design_voice()
    sys.exit()
cards = json.load(sys.stdin)['cards']
english, russian = English(), Russian()
spoken = []
for card in cards:
    en = english.clip(card)
    ru = en and russian.clip(card)
    if en and ru:
        spoken.append((card, read(en), read(ru)))
if not spoken:
    sys.exit('Nothing to play')
mix(spoken)
