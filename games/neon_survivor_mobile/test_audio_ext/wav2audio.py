#!/usr/bin/env python3
"""把 test_audio_ext 的五首扩写版循环 WAV 转成游戏使用的 MP3。

输入:  <id>_ext_loop.wav
输出:  audio/<id>_loop.mp3

使用 112 kbps CBR libmp3lame，并显式写 Xing/Info 头。该头携带编码器
delay/padding，浏览器解码时可裁掉 MP3 编码首尾填充；游戏的 WebAudio
路径还会按采样扫描头尾亚阈值区间，再用 BufferSource 的 loopStart/
loopEnd 做采样级循环。

运行:
    conda run -n game python test_audio_ext/wav2audio.py
"""
import json
import math
import array
import shutil
import subprocess
import sys
import wave
from pathlib import Path


SRC_DIR = Path(__file__).resolve().parent
DST_DIR = SRC_DIR.parent / "audio"
MP3_ARGS = ["-codec:a", "libmp3lame", "-b:a", "112k", "-write_xing", "1"]
EXPECTED_IDS = {"menu", "ruins", "crimson", "frozen", "void"}
SILENCE_THRESHOLD = 0.020
DURATION_TOLERANCE = 0.001


def source_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != 44100 or wav.getnchannels() != 2 or wav.getsampwidth() != 2:
            raise ValueError(f"{path.name}: 必须是 44.1kHz / 16-bit / stereo WAV")
        return wav.getnframes() / wav.getframerate()


def wav_metrics(path: Path) -> tuple[float, float, float, float]:
    """返回 peak、RMS、DC 偏移和循环边界最大跳变（均归一化）。"""
    peak = total_sq = total = 0.0
    count = 0
    first = last = None
    with wave.open(str(path), "rb") as wav:
        while True:
            raw = wav.readframes(262144)
            if not raw:
                break
            samples = array.array("h")
            samples.frombytes(raw)
            if first is None:
                first = tuple(samples[:2])
            last = tuple(samples[-2:])
            for value in samples:
                x = value / 32768.0
                peak = max(peak, abs(x))
                total_sq += x * x
                total += x
            count += len(samples)
    rms = math.sqrt(total_sq / max(1, count))
    dc = abs(total / max(1, count))
    seam = max(abs(first[i] - last[i]) for i in range(2)) / 32768.0
    return peak, rms, dc, seam


def ffprobe_duration(ffmpeg: str, path: Path) -> float | None:
    ffprobe = Path(ffmpeg).with_name("ffprobe")
    if not ffprobe.exists():
        return None
    result = subprocess.run(
        [str(ffprobe), "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (ValueError, KeyError):
        return None


def leading_silence(ffmpeg: str, path: Path, reverse: bool = False) -> float:
    filters = []
    if reverse:
        filters.append("areverse")
    filters.append("silencedetect=noise=-60dB:d=0.005")
    result = subprocess.run(
        [ffmpeg, "-v", "info", "-i", str(path), "-af", ",".join(filters),
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts, ends = [], []
    for line in result.stderr.splitlines():
        if "silence_start:" in line:
            starts.append(float(line.rsplit(":", 1)[1]))
        elif "silence_end:" in line:
            ends.append(float(line.split("silence_end:", 1)[1].split("|", 1)[0]))
    if starts and starts[0] < 0.005:
        return ends[0] - starts[0] if ends else float("inf")
    return 0.0


def has_xing_info(path: Path) -> bool:
    # Xing/Info 位于首个 MPEG frame；4 KiB 足够覆盖。CBR 通常写 Info。
    head = path.read_bytes()[:4096]
    return b"Info" in head or b"Xing" in head


def main() -> int:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("错误: 找不到 ffmpeg；请用 conda game 环境运行。", file=sys.stderr)
        return 1

    wavs = sorted(SRC_DIR.glob("*_ext_loop.wav"))
    ids = {p.name.removesuffix("_ext_loop.wav") for p in wavs}
    if ids != EXPECTED_IDS:
        print(f"错误: 扩写曲目应为 {sorted(EXPECTED_IDS)}，实际为 {sorted(ids)}", file=sys.stderr)
        return 1

    DST_DIR.mkdir(parents=True, exist_ok=True)
    failed = 0
    for wav in wavs:
        track_id = wav.name.removesuffix("_ext_loop.wav")
        out = DST_DIR / f"{track_id}_loop.mp3"
        expected = source_duration(wav)
        peak, rms, dc, seam = wav_metrics(wav)
        metrics_ok = peak < 0.999 and 0.015 <= rms <= 0.50 and dc < 0.03 and seam < 0.30
        cmd = [
            ffmpeg, "-y", "-i", str(wav), *MP3_ARGS,
            "-map_metadata", "-1", str(out),
        ]
        print(f"转换: {wav.name} -> {out.relative_to(SRC_DIR.parent)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            failed += 1
            print(result.stderr[-1200:], file=sys.stderr)
            continue

        duration = ffprobe_duration(ffmpeg, out)
        head_silence = leading_silence(ffmpeg, out)
        tail_silence = leading_silence(ffmpeg, out, reverse=True)
        duration_ok = duration is not None and abs(duration - expected) <= DURATION_TOLERANCE
        silence_ok = head_silence < SILENCE_THRESHOLD and tail_silence < SILENCE_THRESHOLD
        header_ok = has_xing_info(out)
        duration_text = f"{duration:.6f}s" if duration is not None else "未知"
        print(
            f"  {out.stat().st_size / 1024:.0f} KiB · "
            f"时长 {duration_text}/{expected:.6f}s · "
            f"头尾静音 {head_silence * 1000:.0f}/{tail_silence * 1000:.0f}ms · "
            f"Xing/Info {'OK' if header_ok else '缺失'}"
        )
        print(f"  PCM: peak {peak:.3f} · RMS {rms:.3f} · DC {dc:.5f} · seam Δ {seam:.3f}")
        if not (duration_ok and silence_ok and header_ok and metrics_ok):
            failed += 1
            print("  !! gapless 自检失败", file=sys.stderr)

    print(f"\n共 {len(wavs)} 首，成功 {len(wavs) - failed}，失败 {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
