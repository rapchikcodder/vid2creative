#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video compressor - Netflix-style quality-based compression.

Codecs (--codec):
  hevc   H.265 via Intel QSV GPU (default, fast)
  av1    AV1  via SVT-AV1 (matches Clipchamp/YouTube quality, ~50% smaller than hevc)

Quality modes (--mode):
  archival   Visually lossless
  high       Excellent quality
  balanced   Great quality, good compression (default)
  streaming  Capped bitrate for web delivery
"""

import subprocess
import sys
import os
import argparse
import json
from pathlib import Path


# ---------------------------------------------------------------------------
# AV1 CRF values per resolution (SVT-AV1, range 0-63, lower=better quality)
# Tuned to match ~900kbps @ 1080p (Clipchamp/YouTube quality)
# ---------------------------------------------------------------------------
AV1_CRF = {
    "4k":   {"balanced": 38, "high": 32, "archival": 26, "streaming": 38},
    "1440": {"balanced": 36, "high": 30, "archival": 24, "streaming": 36},
    "1080": {"balanced": 35, "high": 28, "archival": 22, "streaming": 35},
    "720":  {"balanced": 33, "high": 26, "archival": 20, "streaming": 33},
    "sd":   {"balanced": 30, "high": 24, "archival": 18, "streaming": 30},
}

# ---------------------------------------------------------------------------
# HEVC quality modes (resolution-adaptive CRF)
# ---------------------------------------------------------------------------
MODES = {
    "archival": {
        "crf": {"4k": 24, "1440": 20, "1080": 18, "720": 16, "sd": 14},
        "preset": "veryslow",
        "desc": "Visually lossless (VMAF 97+, slow)",
    },
    "high": {
        "crf": {"4k": 28, "1440": 25, "1080": 22, "720": 20, "sd": 18},
        "preset": "slow",
        "desc": "Excellent quality (VMAF 95+)",
    },
    "balanced": {
        "crf": {"4k": 32, "1440": 29, "1080": 26, "720": 24, "sd": 22},
        "preset": "slow",
        "desc": "Great quality, good compression (VMAF 93+)",
    },
    "streaming": {
        "crf": {"4k": 32, "1440": 29, "1080": 26, "720": 24, "sd": 22},
        "preset": "slow",
        "desc": "Capped CRF for web/streaming delivery",
        "capped": True,
    },
}

VBV_CAPS = {
    "4k":   {"maxrate": 10000, "bufsize": 20000},
    "1440": {"maxrate":  7000, "bufsize": 14000},
    "1080": {"maxrate":  5000, "bufsize": 10000},
    "720":  {"maxrate":  2500, "bufsize":  5000},
    "sd":   {"maxrate":  1500, "bufsize":  3000},
}


def get_resolution_tier(width, height):
    pixels = width * height
    if pixels >= 3840 * 2160: return "4k"
    if pixels >= 2560 * 1440: return "1440"
    if pixels >= 1920 * 1080: return "1080"
    if pixels >= 1280 * 720:  return "720"
    return "sd"


def get_file_size_mb(path):
    return os.path.getsize(path) / (1024 * 1024)


def get_video_info(path):
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_streams", "-show_format", path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {}
    data = json.loads(result.stdout)
    info = {}
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            info["width"]  = stream.get("width", 0)
            info["height"] = stream.get("height", 0)
            info["codec"]  = stream.get("codec_name", "unknown")
            info["fps"]    = stream.get("r_frame_rate", "?")
    info["duration"] = float(data.get("format", {}).get("duration", 0))
    info["bitrate"]  = int(data.get("format", {}).get("bit_rate", 0))
    return info


def detect_qsv():
    test = subprocess.run(
        ["ffmpeg", "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=1",
         "-t", "1", "-c:v", "hevc_qsv", "-f", "null", "-"],
        capture_output=True
    )
    return test.returncode == 0


# ---------------------------------------------------------------------------
# AV1 encoding (SVT-AV1 — fast, close to Clipchamp/YouTube quality)
# ---------------------------------------------------------------------------
def build_av1_args(tier, mode):
    crf = AV1_CRF[tier].get(mode, AV1_CRF[tier]["balanced"])
    return [
        "-c:v", "libsvtav1",
        "-crf", str(crf),
        "-preset", "8",       # 0=slowest/best .. 13=fastest; 8=fast+good quality
        "-pix_fmt", "yuv420p",
        "-svtav1-params", "tune=0:enable-overlays=1:scd=1",
    ], crf


# ---------------------------------------------------------------------------
# HEVC encoding (Intel QSV GPU or software libx265)
# ---------------------------------------------------------------------------
def get_qsv_bitrate(width, height, source_bitrate_bps):
    tier = get_resolution_tier(width, height)
    caps = {"4k": (6000,10000), "1440": (4000,7000), "1080": (2500,5000),
            "720": (1200,2500), "sd": (800,1500)}
    target_k, max_k = caps[tier]
    if source_bitrate_bps > 0:
        source_k = source_bitrate_bps / 1000
        target_k = min(target_k, int(source_k * 0.42))
        max_k    = min(max_k,    int(source_k * 0.60))
    return target_k, max_k


def build_hevc_qsv_args(width, height, source_bitrate_bps):
    target_k, max_k = get_qsv_bitrate(width, height, source_bitrate_bps)
    return ["-c:v", "hevc_qsv", "-b:v", str(target_k)+"k",
            "-maxrate", str(max_k)+"k"], target_k, max_k


def build_hevc_sw_args(crf, preset, width, height, mode_name):
    x265_params = (
        "bframes=6:weightb=1:hme=1:aq-mode=4:aq-strength=0.8"
        ":psy-rd=1.0:psy-rdoq=1.0:deblock=-1:-1:subme=5"
        ":rc-lookahead=60:no-open-gop=1"
    )
    if MODES[mode_name].get("capped"):
        tier = get_resolution_tier(width, height)
        cap  = VBV_CAPS[tier]
        x265_params += ":vbv-maxrate={}:vbv-bufsize={}".format(
            cap["maxrate"], cap["bufsize"])
    return ["-c:v", "libx265", "-crf", str(crf), "-preset", preset,
            "-pix_fmt", "yuv420p10le", "-x265-params", x265_params]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def compress_video(input_path, output_path=None, mode="balanced",
                   codec="hevc", audio_bitrate="128k"):
    input_path = Path(input_path)
    if not input_path.exists():
        print("[ERROR] File not found: " + str(input_path))
        return False

    if output_path is None:
        output_path = input_path.parent / (
            input_path.stem + "_compressed" + input_path.suffix)
    output_path = Path(output_path)

    info   = get_video_info(str(input_path))
    width  = info.get("width", 1920)
    height = info.get("height", 1080)
    source_bitrate = info.get("bitrate", 0)
    tier   = get_resolution_tier(width, height)

    sep = "=" * 60
    print("\n" + sep)
    print("  Input    : " + input_path.name)
    print("  Output   : " + output_path.name)
    print("  Codec    : " + codec.upper() + "  |  Mode: " + mode)
    print(sep)
    print("  Resolution : " + str(width) + "x" + str(height))
    print("  Source     : " + str(info.get("codec", "?")) + "  " +
          str(round(info.get("duration", 0), 1)) + "s  " +
          str(round(get_file_size_mb(str(input_path)), 2)) + " MB")
    print()

    input_size = get_file_size_mb(str(input_path))

    # ---- AV1 path ----
    if codec == "av1":
        video_args, crf_val = build_av1_args(tier, mode)
        print("  Encoder  : SVT-AV1 (CPU, fast)")
        print("  CRF      : " + str(crf_val) + "  (AV1 scale 0-63)")
        print()
        print("  Compressing...")

        cmd = (["ffmpeg", "-i", str(input_path)]
               + video_args
               + ["-c:a", "aac", "-b:a", audio_bitrate]
               + ["-movflags", "+faststart", "-y", str(output_path)])
        result = subprocess.run(cmd, capture_output=True, text=True)

    # ---- HEVC path ----
    else:
        use_gpu = detect_qsv()
        if use_gpu:
            video_args, target_k, max_k = build_hevc_qsv_args(width, height, source_bitrate)
            print("  Encoder  : HEVC via Intel QSV (GPU)")
            print("  Bitrate  : " + str(round(target_k/1000,1)) + " Mbps  (max " +
                  str(round(max_k/1000,1)) + " Mbps)")
        else:
            crf = MODES[mode]["crf"][tier]
            video_args = build_hevc_sw_args(crf, MODES[mode]["preset"], width, height, mode)
            print("  Encoder  : libx265 (CPU, 10-bit)")
            print("  CRF      : " + str(crf) + "  Preset: " + MODES[mode]["preset"])
        print()
        print("  Compressing...")

        cmd = (["ffmpeg", "-i", str(input_path)]
               + video_args
               + ["-c:a", "aac", "-b:a", audio_bitrate]
               + ["-movflags", "+faststart", "-y", str(output_path)])
        result = subprocess.run(cmd, capture_output=True, text=True)

        # GPU fallback to software
        if result.returncode != 0 and use_gpu:
            print("  [!] QSV failed, falling back to software x265...")
            crf = MODES["balanced"]["crf"][tier]
            sw  = build_hevc_sw_args(crf, MODES["balanced"]["preset"], width, height, "balanced")
            cmd2 = (["ffmpeg", "-i", str(input_path)] + sw
                    + ["-c:a", "aac", "-b:a", audio_bitrate]
                    + ["-movflags", "+faststart", "-y", str(output_path)])
            result = subprocess.run(cmd2, capture_output=True, text=True)

    if result.returncode != 0:
        print("[ERROR] FFmpeg failed:")
        print(result.stderr[-2000:])
        return False

    output_size = get_file_size_mb(str(output_path))
    saved = input_size - output_size
    ratio = (1 - output_size / input_size) * 100 if input_size > 0 else 0

    print()
    print("  [OK] Done!")
    print("  Before : " + str(round(input_size, 2)) + " MB")
    print("  After  : " + str(round(output_size, 2)) + " MB")
    print("  Saved  : " + str(round(saved, 2)) + " MB  (" + str(round(ratio, 1)) + "% smaller)")
    print("  Output : " + str(output_path))
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Netflix/YouTube-style video compressor.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Codecs:
  hevc  H.265 GPU (Intel QSV, fast) — default
  av1   AV1 SVT-AV1 — ~50% smaller than HEVC, matches Clipchamp/YouTube quality

Modes:
  balanced   Great quality (default)
  high       Higher quality, larger file
  archival   Visually lossless
  streaming  Capped for web delivery

Examples:
  python compress_video.py video.mp4
  python compress_video.py video.mp4 --codec av1
  python compress_video.py video.mp4 --codec av1 --mode high
  python compress_video.py *.mp4 --codec av1
        """
    )
    parser.add_argument("inputs", nargs="*",
        help="Input file(s). Omit to compress all videos in current folder.")
    parser.add_argument("-o", "--output", help="Output path (single file only).")
    parser.add_argument("--codec", default="hevc", choices=["hevc", "av1"],
        help="Codec: hevc (default, GPU) or av1 (SVT-AV1, smallest files)")
    parser.add_argument("--mode", default="balanced", choices=list(MODES.keys()),
        help="Quality mode. Default: balanced")
    parser.add_argument("--audio-bitrate", default="128k",
        help="Audio bitrate. Default: 128k")

    args = parser.parse_args()

    VIDEO_EXTS = {".mp4",".mkv",".avi",".mov",".wmv",".flv",".webm",".m4v",".ts"}

    if args.inputs:
        files = [Path(f) for f in args.inputs]
    else:
        files = [f for f in Path(".").iterdir()
                 if f.suffix.lower() in VIDEO_EXTS and "_compressed" not in f.stem]
        if not files:
            print("No video files found. Usage: python compress_video.py [file.mp4 ...]")
            sys.exit(1)
        print("Found " + str(len(files)) + " video(s).")

    if args.output and len(files) > 1:
        print("[ERROR] --output only works with a single input file.")
        sys.exit(1)

    success = 0
    for f in files:
        ok = compress_video(str(f), output_path=args.output or None,
                            mode=args.mode, codec=args.codec,
                            audio_bitrate=args.audio_bitrate)
        if ok:
            success += 1

    print("\n" + "=" * 60)
    print("  Compressed " + str(success) + "/" + str(len(files)) + " file(s).")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
