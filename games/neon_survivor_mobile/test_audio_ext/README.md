# test_audio_ext — 长篇变奏版 BGM 生成器

五首曲目均由纯 Python 标准库离线合成，输出精确到样本的立体声循环 WAV。
主界面采用紧凑的 3 分钟赋格；四张地图采用 8–9 分钟长篇结构，让 20 分钟
对局只完整重复约两次。扩写重点是主题发展、配器疏密与同一音色家族内的
音色演进，而不是简单复制原有段落。

运行 `conda run -n game python test_audio_ext/wav2audio.py` 会把五首
`*_ext_loop.wav` 转为游戏使用的 `audio/*_loop.mp3`，并校验时长、头尾静音
与 Xing/Info gapless 头。曲目 ID、正式文件名及 `js/audio.js` 接口保持不变。

## 曲目规格

| 曲目 | BPM / 拍号 | 小节 | 循环长度 | 主要新增变化 |
|---|---:|---:|---:|---|
| menu | 128 / 4/4 | 96 | 180.000s | 24 次主题入点；呈示、发展、密接、倒影、自由间插、短再现、属持续锁。变化刻意较少，适合短暂停留的主界面。 |
| ruins | 112 / 4/4 | 264 | 565.714s | 主、副主题三次交替；装饰、缩减、卡农、声部交换和联合发展在终段合流。 |
| crimson | 144 / 4/4 | 304 | 506.667s | 高速轮舞 riff 与 H1/H2 长线副主题交替；半速、切分、breakdown-build、第二轮发展和最终高八度叠双。 |
| frozen | 96 / 12/8 | 288 | 540.000s | 两轮副主题及最终复合；冰雾正弦、玻璃泛音和三角琶音以四小节惯性渐变换色，仍然无鼓。 |
| void | 105 / 7/8 | 276 | 552.000s | 下行主主题与反向上行副主题交替；7/8 重音逐步移位，末段以 24 小节联合发展汇合。 |

正式 MP3 使用 112 kbps CBR，总体积约 30 MB。无损 WAV 总样本数如下：

| 曲目 | 总样本数 |
|---|---:|
| menu_ext | 7,938,000 |
| ruins_ext | 24,948,000 |
| crimson_ext | 22,344,000 |
| frozen_ext | 23,814,000 |
| void_ext | 24,343,200 |

## 生成与验证

```bash
python3 test_audio_ext/menu_ext_gen.py
python3 test_audio_ext/ruins_ext_gen.py
python3 test_audio_ext/crimson_ext_gen.py
python3 test_audio_ext/frozen_ext_gen.py
python3 test_audio_ext/void_ext_gen.py
python3 test_audio_ext/longform_checks.py
conda run -n game python test_audio_ext/wav2audio.py
```

每个生成器会先验证音域、段落覆盖、调式或和弦锚点，以及适用曲目的半音
碰撞、平行五八度和单声部重叠；跨曲检查另验证目标时长、主题亲缘、变奏差异、
密度、重复上限和四小节音色渐变；0 错误、0 警告后才渲染。主循环 WAV 之外，
还会生成 20 秒 seam 文件（末 10 秒 + 首 10 秒）供人工检查循环接缝。

长曲渲染使用环形混音，越过末端的音符尾部会卷回开头；归一化 PCM 按块写盘，
避免在内存中额外复制整首 8–9 分钟音频。五首均使用固定种子或确定性算法。

## 循环策略

- menu：E 属持续锁回到 Am。
- ruins：末段 B7 的 D# 导音解决到 Em。
- crimson：末段 E7 的 G# 导音解决到 Am，并以鼓滚奏跨缝。
- frozen：C# 属和声与 E# 悬置解决到 F#m。
- void：A4 长悬与末段滚奏卷回 D 多利亚主题。

生成器仍保持自包含、零第三方 Python 依赖；正式 MP3 编码需要 `game` conda
环境中的 ffmpeg/libmp3lame。
