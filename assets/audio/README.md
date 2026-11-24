# 音频（assets/audio/）

设置面板里的「背景音乐 / 音效」两个滑块控制这里的文件；**没放文件也不会报错**，只是没声音。

## 音轨表

| 文件 | 用途 | 什么时候响 |
|---|---|---|
| `bgm/theme.mp3` | 标题页 / 创建角色 | 打开游戏、回到主页 |
| `bgm/spring.mp3` | 春季 | 局内，按回合轮换 |
| `bgm/summer.mp3` | 夏季 | 同上 |
| `bgm/autumn.mp3` | 秋季 | 同上 |
| `bgm/winter.mp3` | 冬季 | 同上 |
| `bgm/campus.mp3` | 兜底 | 季节曲缺失时使用 |
| `bgm/exam.mp3` | 学期结算 | 弹出期末成绩单时，关闭后回到季节曲 |
| `bgm/ending.mp3` | 结局 | 结局弹窗 |
| `sfx/click.wav` | 按钮、选项卡 | 点击时 |
| `sfx/choice.wav` | 确认选项 | 选择行动 / 事件选项 |
| `sfx/toast.wav` | 提示 | 弹 toast 时 |
| `sfx/bell.wav` | 下课铃 | 进入下一周 |
| `sfx/firework.wav` | 烟花 | 结局弹窗 |

## 季节曲怎么选

`src/main.js` 的 `SEASON_BGM` 与 `src/ui/ui.js` 的 `SEASON_CYCLE` 对齐（10 回合一年）：

```
回合 1-3   秋    autumn
回合 4-6   冬    winter
回合 7-9   春    spring
回合 10    夏    summer
```

`bgmForTurn(turn)` 给出当前该放的曲子，`renderState()` 每次渲染时调用；同一首重复调用不会重建 `<audio>` 元素。

## 体积

BGM 共约 **38 MB**（单曲 3–7 MB）。浏览器只加载当前这一首，所以首屏只拉 `theme.mp3`，切季节时再拉对应曲目。
要压到 1 MB/首需要 ffmpeg 重编码（本机暂未安装）：

```bash
ffmpeg -i in.mp3 -codec:a libmp3lame -b:a 96k -ac 1 out.mp3
```

音效是 22.05 kHz 单声道 wav：`bell` 1.2 MB、`firework` 1.2 MB；`click/choice/toast` 是合成的短音（2–7 KB）。

## 音量与静音

- 两个滑块都是 0–100，拖动即时生效，保存后写入设置（`scusim:settings`）随下次启动恢复；
- 内部把 0–100 换算成 `<audio>.volume` 的 0–1；
- 浏览器禁止自动播放时，BGM 会静默失败，等玩家第一次点击后即可正常播放。

## 代码位置

`src/audio/audio.js` —— 纯逻辑、顶层不碰 DOM，Node 里可以直接 import 测试；浏览器里用 `<audio>` 播放。
接线在 `src/main.js`：局内季节曲、考试/结局换曲、进入下一周的铃声。
