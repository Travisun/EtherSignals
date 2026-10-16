#!/usr/bin/env python3
"""Find i18n dict keys used in source but missing from zh-CN / en dicts."""
import re, json, subprocess, pathlib

SRC = pathlib.Path('src')

def load_dict(path):
    src = pathlib.Path(path).read_text()
    # export const zh = { ... } as const;  /  export const en = { ... }
    src = re.sub(r'^export const \w+\s*(?::\s*\w+)?\s*=\s*', 'module.exports = ', src, count=1, flags=re.M)
    src = re.sub(r'^export (type|interface) [^;]+;?\s*$', '', src, flags=re.M)
    src = re.sub(r'^import [^;]+;\s*$', '', src, flags=re.M)
    src = re.sub(r'\bas (const|Dict)\b', '', src)
    src = re.sub(r'module\.exports\.\w+\s*=\s*[^;]+;\s*$', '', src)  # trailing exports if any
    js = f"""
const m = {{}};
(function(){{ const module = {{ exports: {{}} }};
{src}
Object.assign(m, module.exports);
}})();
console.log(JSON.stringify(m));
"""
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f'{path}: {out.stderr[:400]}')
    return json.loads(out.stdout)

def flatten(d, prefix=''):
    keys = set()
    for k, v in d.items():
        full = f'{prefix}{k}'
        if isinstance(v, dict):
            keys |= flatten(v, full + '.')
        else:
            keys.add(full)
    return keys

zh = load_dict('src/i18n/dicts/zh-CN.ts')
en = load_dict('src/i18n/dicts/en.ts')
zh_keys = flatten(zh)
en_keys = flatten(en)

# 1) literal keys: t('...') and notifText(t, '...') patterns
used = set()
for f in SRC.rglob('*.ts*'):
    text = f.read_text()
    used |= set(re.findall(r"\bt\(\s*['\"]([\w.]+)['\"]", text))
    used |= set(re.findall(r"\bt\(\s*`([\w.${}]+)`", text))  # template literals (may contain ${})

# 2) dynamic key families
dynamic = {}
for f in SRC.rglob('*.ts*'):
    text = f.read_text()
    for m in re.finditer(r"t\(\s*`([\w.]+)_\$\{", text):
        dynamic[m.group(1) + '_*'] = f.name

# known channel values (auditCategory in notifier + activity filter)
CHANNELS = ['strategy', 'grid', 'trade', 'llm', 'backtest', 'system', 'signal']
for c in CHANNELS:
    used.add(f'activity.channel_{c}')

# server notification codes (TEMPLATES in notifyTexts + all notify() call sites)
notif_codes = set()
nt = pathlib.Path('src/server/i18n/notifyTexts.ts').read_text()
notif_codes |= set(re.findall(r"^\s*'([\w.]+)':\s*\{", nt, flags=re.M))
for f in SRC.rglob('*.ts*'):
    text = f.read_text()
    notif_codes |= set(re.findall(r"notify\(\s*'([\w.]+)'", text))
for c in notif_codes:
    used.add(f'notif.{c}')

used = {k for k in used if '${' not in k}
missing_zh = sorted(k for k in used if k not in zh_keys and not k.startswith('notif._'))
missing_en = sorted(k for k in used if k not in en_keys and not k.startswith('notif._'))
# keys present in zh but missing in en (untranslated)
en_lagging = sorted(k for k in zh_keys if k not in en_keys)
zh_lagging = sorted(k for k in en_keys if k not in zh_keys)

print('== dynamic key prefixes (ensure families exist) ==')
for k, f in sorted(dynamic.items()):
    print(f'  {k}  ({f})')

print('\n== used in code but MISSING from zh-CN ==')
for k in missing_zh: print('  ', k)
print('\n== used in code but MISSING from en ==')
for k in missing_en: print('  ', k)
print('\n== in zh but missing in en ==')
for k in en_lagging: print('  ', k)
print('\n== in en but missing in zh ==')
for k in zh_lagging: print('  ', k)
print('\n(literal+dynamic keys checked:', len(used), '| zh keys:', len(zh_keys), '| en keys:', len(en_keys), ')')
