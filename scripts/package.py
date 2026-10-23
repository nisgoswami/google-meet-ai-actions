"""Build a runtime-only Chrome extension ZIP. No configuration or credentials."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
files = [
    'markdown.js', 'vendor/turndown.js', 'vendor/turndown.LICENSE',
    'prompts.js', 'manifest.json', 'core.js', 'content.js', 'background.js',
    'adapters/google-meet.js', 'options.html', 'options.css', 'options.js',
    'LICENSE', 'PRIVACY.md',
    *[f'icons/icon-{size}.png' for size in (16, 32, 48, 128)],
]
destination = root / 'dist' / f'threadport-{manifest["version"]}.zip'
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(destination)
