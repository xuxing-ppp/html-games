#!/usr/bin/env python3
"""Optional maintenance tool. Playing needs neither Python nor cwebp."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quality', type=int, default=84, choices=range(1, 101), metavar='1..100')
    args = parser.parse_args()
    compress(args.quality)
