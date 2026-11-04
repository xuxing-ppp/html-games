#!/usr/bin/env python3
"""Optional maintenance tool. Playing needs neither Python nor cwebp."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ORIGINALS = ROOT / 'assets' / 'originals'
RUNTIME = ROOT / 'assets' / 'runtime'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compress(quality):
    encoder = shutil.which('cwebp')
    if not encoder:
        raise SystemExit('Compression needs the optional cwebp maintenance tool. The game itself needs no installation.')
    sources = sorted(ORIGINALS.glob('*.png'))
    if not sources:
        raise SystemExit('No originals found in assets/originals/.')
    RUNTIME.mkdir(parents=True, exist_ok=True)
    rows = []
    for source in sources:
        source_hash = digest(source)
        target = RUNTIME / (source.stem + '.webp')
        subprocess.run([encoder, '-quiet', '-q', str(quality), '-m', '6', '-sharp_yuv',
                        '-metadata', 'icc', str(source), '-o', str(target)], check=True)
        if digest(source) != source_hash:
            raise RuntimeError('Original unexpectedly changed: ' + source.name)
        width, height = struct.unpack('>II', source.read_bytes()[16:24])
        rows.append(dict(file=source.stem, width=width, height=height,
                         original_bytes=source.stat().st_size, original_sha256=source_hash,
                         runtime_bytes=target.stat().st_size, runtime_sha256=digest(target)))
    manifest = dict(format='WebP', quality=quality, method=6, sharp_yuv=True,
                    resized=False, images=rows,
                    original_bytes=sum(r['original_bytes'] for r in rows),
                    runtime_bytes=sum(r['runtime_bytes'] for r in rows))
    (ROOT / 'docs' / 'asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"{len(rows)} images: {manifest['original_bytes']:,} -> {manifest['runtime_bytes']:,} bytes "
          f"({100 * (1 - manifest['runtime_bytes'] / manifest['original_bytes']):.1f}% smaller). Originals unchanged.")


def pack():
    # Explicit allowlist: never ship originals, tests, tools, caches or development docs.
    files = [ROOT / 'index.html', ROOT / 'version.js']
    files += sorted((ROOT / 'css').glob('*.css'))
    files += sorted((ROOT / 'js').rglob('*.js'))
    files += sorted(RUNTIME.glob('*.webp'))
    if not list(RUNTIME.glob('*.webp')):
        raise SystemExit('Missing assets/runtime/*.webp. Compress the originals first.')
    destination = ROOT / 'releases' / 'ming-magistrate-offline.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, 'ming_magistrate/' + path.relative_to(ROOT).as_posix())
    print(f'Offline package: {destination.relative_to(ROOT)} ({destination.stat().st_size:,} bytes; {len(files)} files).')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quality', type=int, default=84, choices=range(1, 101), metavar='1..100')
    parser.add_argument('--pack', action='store_true', help='also create a runtime-only offline zip')
    parser.add_argument('--pack-only', action='store_true', help='package existing runtime files without recompression')
    args = parser.parse_args()
    if not args.pack_only:
        compress(args.quality)
    if args.pack or args.pack_only:
        pack()
