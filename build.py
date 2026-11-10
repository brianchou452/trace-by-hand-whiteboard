"""Build the whiteboard and review pages in public/.

- Embeds the LeetCode problem list (data/problems.csv) into /*PROBLEMS*/[]
- Embeds the vendored Highlight.js browser bundle into /*HIGHLIGHT_JS*/
- Embeds UI translations (i18n/<lang>.json, keys = Traditional Chinese source strings) into /*I18N*/{}

Usage: python3 build.py
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
LANGS = ['zh-CN', 'en', 'ja', 'ko', 'fr', 'hi']

def embedded_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')


probs = []
with open(os.path.join(HERE, 'data', 'problems.csv'), encoding='utf-8') as f:
    for r in csv.DictReader(f):
        probs.append([int(r['id']), r['title'], r['slug'], r['difficulty']])
probs.sort()

src = open(os.path.join(HERE, 'src', 'canvas_src.html'), encoding='utf-8').read()
assert '/*PROBLEMS*/[]' in src and '/*I18N*/{}' in src
page = src.replace('/*PROBLEMS*/[]', embedded_json(probs))

keys = json.load(open(os.path.join(HERE, 'i18n', 'source_zh-TW.json'), encoding='utf-8'))
i18n = {}
for lang in LANGS:
    d = json.load(open(os.path.join(HERE, 'i18n', lang + '.json'), encoding='utf-8'))
    missing = [k for k in keys if k not in d]
    if missing:
        print(f'[{lang}] missing {len(missing)} keys, e.g. {missing[:3]}')
    i18n[lang] = {k: v for k, v in d.items() if k in keys and v}
page = page.replace('/*I18N*/{}', embedded_json(i18n))

with open(os.path.join(HERE, 'src', 'vendor', 'highlight-11.11.1.min.js'), encoding='utf-8') as f:
    highlighter = f.read()
with open(os.path.join(HERE, 'src', 'vendor', 'highlight-LICENSE'), encoding='utf-8') as f:
    license_text = f.read()
page = page.replace('/*HIGHLIGHT_JS*/', '/*!\n' + license_text + '*/\n' + highlighter)

body = page.replace('<meta charset="utf-8">\n', '')
cut = body.index('</style>') + len('</style>')
html = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + body[:cut] +
        '\n</head>\n<body>\n' + body[cut:] + '\n</body>\n</html>\n')
os.makedirs(os.path.join(HERE, 'public'), exist_ok=True)
open(os.path.join(HERE, 'public', 'index.html'), 'w', encoding='utf-8').write(html)
print(f'{len(probs)} problems, {len(i18n)} translations, {round(len(html) / 1024)} KB -> public/index.html')

review_lists = json.load(open(os.path.join(HERE, 'data', 'review_lists.json'), encoding='utf-8'))
catalog_slugs = {row[2] for row in probs}
grind_slugs = [slug for slug, minutes in review_lists['grind']['problems'] if minutes > 0]
assert len(grind_slugs) == len(set(grind_slugs)) == 75
for slugs in [grind_slugs, *(entry['slugs'] for entry in review_lists['labels'].values())]:
    assert len(slugs) == len(set(slugs)) and set(slugs) <= catalog_slugs

review_i18n = json.load(open(os.path.join(HERE, 'i18n', 'review.json'), encoding='utf-8'))
review = open(os.path.join(HERE, 'src', 'review_src.html'), encoding='utf-8').read()
palette = src[src.index(':root{'):src.index('html,body{')]
review = review.replace('/*PALETTE*/', palette)
review = review.replace('/*PROBLEMS*/[]', embedded_json(probs))
review = review.replace('/*REVIEW_LISTS*/{}', embedded_json(review_lists))
review = review.replace('/*REVIEW_I18N*/{}', embedded_json(review_i18n))
for marker, file in [('/*REVIEW_MODEL*/', 'review_model.js'), ('/*REVIEW_APP*/', 'review_app.js')]:
    review = review.replace(marker, open(os.path.join(HERE, 'src', file), encoding='utf-8').read().rstrip())
open(os.path.join(HERE, 'public', 'review.html'), 'w', encoding='utf-8').write(review)
print(f'{len(grind_slugs)} Grind 75 problems, {round(len(review) / 1024)} KB -> public/review.html')
