/**
 * 音频层自检：默认值、0–100 换算、静音、非法值回落、Node 环境安全。
 * 运行：node tests/verify_audio.mjs
 */
import fs from 'node:fs';
import { createAudio } from '../src/audio/audio.js';

let pass = 0;
let fail = 0;
const rows = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    rows.push('PASS  ' + name);
  } else {
    fail += 1;
    rows.push('FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), 'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}

// 1) Node 环境：没有 Audio 构造器也必须能安全创建
const audio = createAudio({});
const s0 = audio.getState();
eq('Node 下 supported=false', s0.supported, false);
eq('默认 BGM 60', s0.bgmVolume, 60);
eq('默认音效 80', s0.sfxVolume, 80);
eq('默认未静音', s0.muted, false);

// 2) 不做任何事就调播放：静默不抛错
let threw = false;
try {
  audio.playBgm('theme');
  audio.playBgm('不存在的音轨');
  audio.playSfx('click');
  audio.stopBgm();
} catch {
  threw = true;
}
eq('无音频设备时 play 不抛错', threw, false);

// 3) 0–100 换算与夹取
eq('setBgmVolume(30)', audio.setBgmVolume(30), 30);
eq('setBgmVolume(180) 夹到 100', audio.setBgmVolume(180), 100);
eq('setBgmVolume(-20) 夹到 0', audio.setBgmVolume(-20), 0);
eq('setBgmVolume(非数字) 回默认 60', audio.setBgmVolume('abc'), 60);
eq('setSfxVolume(45)', audio.setSfxVolume(45), 45);

// 4) 静音开关
eq('setMuted(true)', audio.setMuted(true), true);
eq('静音后状态 muted=true', audio.getState().muted, true);
eq('setMuted(false)', audio.setMuted(false), false);

// 5) apply 批量套用（存档/设置里读出来的对象）
const applied = audio.apply({ bgmVolume: 25, sfxVolume: 95, muted: true });
eq('apply bgmVolume', applied.bgmVolume, 25);
eq('apply sfxVolume', applied.sfxVolume, 95);
eq('apply muted', applied.muted, true);

// 6) 缺字段时保留当前值，不炸
const partial = audio.apply({ sfxVolume: 10 });
eq('apply 只给 sfxVolume 时 bgm 不变', partial.bgmVolume, 25);
eq('apply sfxVolume 生效', partial.sfxVolume, 10);

// 7) 音轨表存在且是 mp3
ok('BGM 音轨表含 theme/campus', !!audio.BGM_TRACKS.theme && !!audio.BGM_TRACKS.campus);
ok('SFX 音轨表含 click/choice/toast', !!audio.SFX_TRACKS.click && !!audio.SFX_TRACKS.choice && !!audio.SFX_TRACKS.toast);
ok('音轨都是 mp3', Object.values(audio.BGM_TRACKS).every((f) => f.endsWith('.mp3')));

// 8) 注入假 Audio：验证真的把 volume 写到了元素上
const made = [];
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this.loop = false;
    this.paused = true;
    made.push(this);
  }
  play() {
    this.paused = false;
    return { catch() {} };
  }
  pause() {
    this.paused = true;
  }
}
const withAudio = createAudio({ Audio: FakeAudio });
withAudio.apply({ bgmVolume: 40, sfxVolume: 70, muted: false });
withAudio.playBgm('theme');
eq('创建了 1 个 <audio>', made.length, 1);
eq('BGM 音量写入元素', made[0].volume, 0.4);
eq('BGM 循环开启', made[0].loop, true);
eq('BGM 路径正确', made[0].src, 'assets/audio/bgm/theme.mp3');

withAudio.setBgmVolume(90);
eq('改音量后元素同步', made[0].volume, 0.9);

withAudio.playSfx('click');
eq('音效另起一个元素', made.length, 2);
eq('音效音量', made[1].volume, 0.7);
eq('音效不循环', made[1].loop, false);
eq('音效路径正确', made[1].src, 'assets/audio/sfx/click.wav');

withAudio.setMuted(true);
eq('静音后 BGM 音量为 0', made[0].volume, 0);

withAudio.stopBgm();
eq('stopBgm 后处于暂停', made[0].paused, true);

// 9) 同一首 BGM 重复播放不会重建元素
const before = made.length;
withAudio.setMuted(false);
withAudio.playBgm('theme');
withAudio.playBgm('theme');
eq('重复播放同一首不重复创建', made.length, before + 1);

// 10) 季节 / 考试 / 结局音轨
ok('BGM 含四季', ['spring', 'summer', 'autumn', 'winter'].every((k) => !!audio.BGM_TRACKS[k]));
ok('BGM 含 exam/ending', !!audio.BGM_TRACKS.exam && !!audio.BGM_TRACKS.ending);
ok('SFX 含 bell/firework', !!audio.SFX_TRACKS.bell && !!audio.SFX_TRACKS.firework);
const seasonAudio = createAudio({ Audio: FakeAudio });
['spring', 'summer', 'autumn', 'winter', 'exam', 'ending'].forEach((k) => seasonAudio.playBgm(k));
ok('季节曲路径都存在对应文件', ['spring', 'summer', 'autumn', 'winter', 'exam', 'ending']
  .every((k) => fs.existsSync('assets/audio/bgm/' + k + '.mp3')));

console.log(rows.join('\n'));
console.log('\n总计 ' + (pass + fail) + ' 项，PASS ' + pass + '，FAIL ' + fail);
if (fail > 0) process.exitCode = 1;
