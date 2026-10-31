/**
 * SCUSim · UI 表现层（负责人 C · 寇豆码）
 *
 * 视觉形态：橙光式「视觉小说（VN）」——
 *   全屏场景背景 + 立绘 + 底部半透明对话框 + 中央选项条 + 右侧菜单抽屉。
 *
 * 设计红线（与 M1 一致，测试 tests/verify_ui.mjs 会扫描）：
 *  - 本文件【零 import】。不引入 core / events / storage / config 任何模块。
 *  - 所有状态变更【只经 callbacks】，UI 只读 state，绝不回写 GameState。
 *  - DOM 一律经 ctx.doc 注入（浏览器传 document，测试传桩）。
 *  - 不使用原生随机、不直接访问浏览器持久化能力；外观/场景属于 UI 内部视图状态。
 *
 * 素材契约：见 assets/README.md
 *  背景 → assets/bg/<scene>.jpg，缺失时自动回落到内置 CSS 渐变场景；
 *  立绘 → assets/char/<id>.png，APPEARANCES[i].art 为 true 时启用。
 *  美术到位后把 ART.enabled 置为 true（或告诉我，我来改）。
 *
 * createApp({ config, callbacks, doc?, appearance? }) -> {
 *   mount(rootEl, options?), render(state, view?), setAppearance(id),
 *   showEvent(ev), showEnding(e), showError(msg), showToast(msg),
 *   showGallery(g), showSettings(settings, onSave), showBacklog(),
 *   openMenu(), closeOverlay(), startCreation(), startTitle(hasSave)
 * }
 */

// ---------------------------------------------------------------------------
// 一、常量与展示元数据
// ---------------------------------------------------------------------------

const ATTRIBUTE_META = [
  { key: 'knowledge', name: '学识', icon: '📖' },
  { key: 'social', name: '社交', icon: '💬' },
  { key: 'health', name: '健康', icon: '🍀' },
  { key: 'money', name: '金钱', icon: '💰' },
];

const TOTAL_POINTS = 20; // 属性分配总和硬约束（与 balance.attributePointTotal 一致）
const REQUIRED_TAGS = 3; // 标签数量硬约束
const ATTR_DISPLAY_MAX = 60; // 属性条填充百分比的展示上限
const NEXT_WEEK_TEXT = '进入下一周';

/**
 * 美术开关：素材就位后置为 true。
 * 关闭时不会向服务器请求不存在的图片，场景完全由 CSS 渐变绘制。
 */
const ART = {
  enabled: true,
  bgDir: 'assets/bg/',
  charDir: 'assets/char/',
};

/** 场景清单：键名即 CSS 类名后缀，art 为 assets/bg/ 下的文件名。 */
const SCENES = {
  title: { art: 'title.jpg', label: '四川大学 · 黄昏' },
  campus: { art: 'campus.jpg', label: '校园 · 林荫道' },
  classroom: { art: 'study.jpg', label: '第一教学楼 · 教室' },
  clubroom: { art: 'clubroom.jpg', label: '社团活动室 · 照片墙' },
  track: { art: 'track.jpg', label: '体育馆 · 羽毛球馆' },
  store: { art: 'store.jpg', label: '地铁 8 号线 · 站台' },
  street: { art: 'street.jpg', label: '校外 · 火锅店' },
  dorm: { art: 'rest.jpg', label: '校园 · 回宿舍的路' },
  event: { art: null, label: '校园 · 此刻' },
};

/** 行动 → 场景（每个本周行动对应不同背景）。 */
const ACTION_SCENE = {
  study: 'classroom',
  club: 'clubroom',
  exercise: 'track',
  parttime: 'store',
  socialize: 'street',
  rest: 'dorm',
};

/** 行动旁白（旁白腔，避免与数值说明混淆）。 */
const ACTION_FLAVOR = {
  study: [
    '（投影亮着「欢迎新同学」，你翻开课本，从第一页做起）',
    '（空调的风把窗帘吹得一鼓一鼓，你把笔记抄满了整页）',
    '（下课铃响过很久，教室里只剩翻书的声音）',
  ],
  club: [
    '（活动室的墙上钉满了往年活动的照片，一角还留着没撕干净的胶带）',
    '（部长指着照片里的人群说：今年你也得在上面）',
    '（第一次觉得，大学的热闹原来是这样堆出来的）',
  ],
  exercise: [
    '（球拍挥到手臂发酸，馆里的灯白得有点刺眼）',
    '（捡球的间隙，你听见隔壁场地在喊「好球」）',
    '（出了一身汗，走回宿舍的路上风都变凉了）',
  ],
  parttime: [
    '（晚高峰的 8 号线，你被挤在门口，耳机里放着兼职群的消息）',
    '（站台的灯一格一格地亮，你数着还有几站到学校）',
    '（回到学校已经十点，便利店的关东煮还剩最后两串）',
  ],
  socialize: [
    '（牛油锅咕嘟咕嘟地响，几只杯子在半空中碰在一起）',
    '（一桌人抢最后一片毛肚，笑声比锅还沸）',
    '（散场时夜风一吹，你才发现自己的脸有点烫）',
  ],
  rest: [
    '（路灯一盏一盏亮起来，你沿着林荫道慢慢往回走）',
    '（回到宿舍，把鞋一蹬，整个人陷进椅子里）',
    '（手机屏幕的光照在天花板上，你不知不觉就睡了）',
  ],
};

/** 每周开场旁白（按回合序号轮转，保证可复现）。 */
const WEEK_LINES = [
  '（新的一周开始了，去教学楼的路上起了点风）',
  '（早八的教室总有股粉笔灰的味道）',
  '（食堂的窗口排起了长队，你决定先去教室）',
  '（梧桐叶落了一地，踩上去沙沙响）',
  '（图书馆前的台阶被晒得发烫）',
  '（这一周好像会过得很快）',
];

/** 立绘（玩家可选形象）。art 为 true 时读取 ART.charDir + file。 */
const APPEARANCES = [
  {
    id: 'm_hoodie', name: '短发男生1', gender: '男',
    art: true, file: 'm_hoodie.webp', c1: '#dfe9f7', c2: '#2f3f66',
  },
  {
    id: 'f_long', name: '长发女生1', gender: '女',
    art: true, file: 'f_long.webp', c1: '#ffe4ec', c2: '#c98fa8',
  },
];

const DEFAULT_APPEARANCE = APPEARANCES[0].id;

// ---------------------------------------------------------------------------
// 二、API 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 UI 应用。
 * @param {object} ctx { config, callbacks, doc?, appearance? }
 * @returns {object} 视图控制接口
 */
export function createApp(ctx) {
  const config = ctx && ctx.config ? ctx.config : null;
  const callbacks = (ctx && ctx.callbacks) || {};
  const doc =
    (ctx && ctx.doc) ||
    (typeof globalThis !== 'undefined' ? globalThis.document : null);

  let rootEl = null;
  let overlayEl = null;
  let overlayClose = null;
  let overlayStage = null;
  let lastState = null;
  let keysBound = false;
  let typeRaf = null;

  // UI 内部视图状态（不是 GameState，不参与存档结算）
  const ui = {
    appearanceId: resolveAppearanceId(ctx && ctx.appearance),
    scene: 'campus',
    speaker: '',
    text: '',
    effects: [],
    consumedSeq: 0,
    lastTurn: 0,
    history: [],
    reduceMotion: false,
  };

  // ---------------- 轻量 DOM 构造器 ----------------
  function h(tag, attrs, children) {
    const node = doc.createElement(tag);
    const a = attrs || {};
    for (const key of Object.keys(a)) {
      const val = a[key];
      if (val == null || val === false) continue;
      if (key === 'class') node.className = val;
      else if (key === 'text') node.textContent = val;
      else if (key === 'html') node.innerHTML = val;
      else if (key === 'style') node.setAttribute('style', val);
      else if (key === 'value') {
        node.value = val;
        node.setAttribute('value', val);
      } else if (key === 'selected') node.selected = true;
      else if (key === 'disabled') {
        node.disabled = true;
        node.setAttribute('disabled', 'disabled');
      } else if (key.indexOf('on') === 0 && typeof val === 'function') {
        node.addEventListener(key.slice(2), val);
      } else if (key === 'dataset') {
        for (const dk of Object.keys(val)) node.dataset[dk] = val[dk];
      } else node.setAttribute(key, val);
    }
    const kids = children == null ? [] : Array.isArray(children) ? children : [children];
    for (const c of kids) {
      if (c == null || c === false) continue;
      node.appendChild(
        typeof c === 'string' || typeof c === 'number'
          ? doc.createTextNode(String(c))
          : c
      );
    }
    return node;
  }

  function clearRoot() {
    if (rootEl) rootEl.innerHTML = '';
  }

  function stopTypewriter() {
    if (typeRaf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(typeRaf);
    }
    typeRaf = null;
  }

  function closeOverlay() {
    stopTypewriter();
    if (overlayClose) {
      try {
        overlayClose();
      } catch (_) {
        /* 关闭钩子异常不影响后续渲染 */
      }
    }
    overlayClose = null;
    if (overlayStage && overlayStage.classList) {
      overlayStage.classList.remove('is-event');
      overlayStage = null;
    }
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  /** 事件弹层期间，把舞台上的行动按钮压暗，避免两层选项互相干扰。 */
  function markStageEvent(on) {
    if (!rootEl) return;
    const stage = typeof rootEl.querySelector === 'function'
      ? rootEl.querySelector('.vn-stage')
      : null;
    if (!stage || !stage.classList) return;
    if (on) {
      stage.classList.add('is-event');
      overlayStage = stage;
    } else {
      stage.classList.remove('is-event');
      overlayStage = null;
    }
  }

  function mountOverlay(node, onClose) {
    overlayEl = node;
    overlayClose = onClose || null;
    if (rootEl) rootEl.appendChild(node);
  }

  // ---------------- 配置查询（只读数据查找，非 import） ----------------
  function listOf(group) {
    return (config && config[group] && Array.isArray(config[group].list))
      ? config[group].list
      : [];
  }

  function findAction(actionId) {
    return listOf('actions').find((a) => a.id === actionId) || null;
  }

  function findEventById(id) {
    const ev = config && config.events;
    if (!ev) return null;
    const all = [].concat(ev.fixed || [], ev.random || []);
    return all.find((e) => e.id === id) || null;
  }

  function findCollege(id) {
    return listOf('colleges').find((c) => c.id === id) || null;
  }

  function findCollegeName(id) {
    const c = findCollege(id);
    return c ? c.name : id || '';
  }

  function findTagName(id) {
    const t = listOf('tags').find((x) => x.id === id);
    return t ? t.name : id || '';
  }

  function balanceOf(key, fallback) {
    const b = (config && config.balance) || {};
    return Number.isFinite(b[key]) ? b[key] : fallback;
  }

  // ---------------- 立绘 / 场景辅助 ----------------
  function resolveAppearanceId(id) {
    if (typeof id === 'string' && APPEARANCES.some((a) => a.id === id)) return id;
    return DEFAULT_APPEARANCE;
  }

  function findAppearance(id) {
    return APPEARANCES.find((a) => a.id === resolveAppearanceId(id)) || APPEARANCES[0];
  }

  function defaultAppearanceFor(gender) {
    const hit = APPEARANCES.find((a) => a.gender === gender);
    return hit ? hit.id : DEFAULT_APPEARANCE;
  }

  function sceneKeyOf(key) {
    return Object.prototype.hasOwnProperty.call(SCENES, key) ? key : 'campus';
  }

  function sceneLabel(key) {
    return (SCENES[sceneKeyOf(key)] || SCENES.campus).label;
  }

  function sceneArtStyle(key) {
    if (!ART.enabled) return null;
    const scene = SCENES[sceneKeyOf(key)];
    if (!scene || !scene.art) return null;
    return 'background-image:url("' + ART.bgDir + scene.art + '")';
  }

  function spriteArtStyle(appearance) {
    if (!ART.enabled || !appearance || !appearance.art || !appearance.file) return null;
    return 'background-image:url("' + ART.charDir + appearance.file + '")';
  }

  // ---------------- 文本格式化 ----------------
  function effectChips(effects) {
    const out = [];
    const attrs = (effects && effects.attributes) || {};
    for (const meta of ATTRIBUTE_META) {
      const delta = Number(attrs[meta.key]);
      if (!Number.isFinite(delta) || delta === 0) continue;
      out.push({
        text: meta.icon + ' ' + meta.name + ' ' + (delta > 0 ? '+' : '−') + Math.abs(delta),
        kind: delta > 0 ? 'up' : 'down',
      });
    }
    return out;
  }

  function semesterLabel(turn) {
    const perSemester = balanceOf('monthsPerSemester', 5);
    const total = Math.max(1, Math.ceil(Number(turn) / perSemester));
    const yearLabel = '大' + ['一', '二', '三', '四'][Math.min(3, Math.floor((total - 1) / 2))];
    const term = total % 2 === 1 ? '上' : '下';
    return yearLabel + term + ' · 第' + total + '学期';
  }

  function weekLine(turn) {
    const i = Math.max(0, (Number(turn) || 1) - 1) % WEEK_LINES.length;
    return WEEK_LINES[i];
  }

  // ---------------- 打字机 ----------------
  function prefersReducedMotion() {
    if (typeof matchMedia !== 'function') return false;
    try {
      return !!matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function syncMotionPreference() {
    const root = doc && doc.documentElement;
    if (root && root.classList && typeof root.classList.contains === 'function') {
      if (root.classList.contains('reduce-motion')) ui.reduceMotion = true;
    }
  }

  function typeText(node, full) {
    stopTypewriter();
    if (!node) return;
    syncMotionPreference();
    const text = full == null ? '' : String(full);
    if (!text) {
      node.textContent = '';
      return;
    }
    const canAnimate =
      typeof requestAnimationFrame === 'function' &&
      typeof cancelAnimationFrame === 'function' &&
      !ui.reduceMotion &&
      !prefersReducedMotion();
    if (!canAnimate) {
      node.textContent = text;
      return;
    }
    node.textContent = '';
    let i = 0;
    const step = () => {
      i = Math.min(text.length, i + 2);
      node.textContent = text.slice(0, i);
      if (i < text.length) {
        typeRaf = requestAnimationFrame(step);
      } else {
        typeRaf = null;
      }
    };
    typeRaf = requestAnimationFrame(step);
  }

  // ---------------- 通用组件 ----------------
  function bgLayer(key) {
    const k = sceneKeyOf(key);
    return h('div', { class: 'vn-bg vn-scene--' + k }, [
      h('div', { class: 'vn-bg__paint' }),
      h('div', { class: 'vn-bg__art', style: sceneArtStyle(k) }),
      h('div', { class: 'vn-bg__veil' }),
    ]);
  }

  function spriteLayer(appearance) {
    const app = appearance || findAppearance(ui.appearanceId);
    const art = spriteArtStyle(app);
    const tint =
      'background:linear-gradient(180deg,' + app.c1 + ' 0%,' + app.c2 + ' 100%)';
    return h('div', { class: 'vn-sprite' + (art ? '' : ' vn-sprite--empty'), title: app.name }, [
      h('div', { class: 'vn-sprite__glow' }),
      art
        ? h('div', { class: 'vn-sprite__art', style: art })
        : h('div', { class: 'vn-sprite__frame' }, [
            h('span', { class: 'vn-sprite__tint', style: tint }),
            h('span', { class: 'vn-sprite__hint' }, ['立绘位']),
            h('span', { class: 'vn-sprite__name' }, [app.name]),
          ]),
    ]);
  }

  function apDots(ap, apMax) {
    return h(
      'span',
      { class: 'vn-aps' },
      Array.from({ length: Math.max(0, apMax) }, (_, i) =>
        h('i', { class: 'vn-ap' + (i < ap ? ' is-on' : '') })
      )
    );
  }

  function hud(state, view) {
    const maxTurn = balanceOf('turns', 40);
    const apMax = balanceOf('actionPointsPerTurn', 4);
    const player = state.player || {};
    const showSeed = view && view.seed ? String(view.seed) : '';
    return h('div', { class: 'vn-hud' }, [
      h('div', { class: 'vn-hud__group' }, [
        h('span', { class: 'vn-chip vn-chip--gold' }, [
          '第 ' + state.turn + ' / ' + maxTurn + ' 周',
        ]),
        h('span', { class: 'vn-chip' }, [semesterLabel(state.turn)]),
        h('span', { class: 'vn-chip vn-chip--glass' }, [
          h('span', { class: 'vn-chip__k' }, ['行动点']),
          apDots(state.actionPoints, apMax),
        ]),
        showSeed ? h('span', { class: 'vn-chip' }, ['种子 ' + showSeed]) : null,
      ]),
      h('div', { class: 'vn-hud__group' }, [
        h('span', { class: 'vn-loc' }, ['◈ ' + sceneLabel(ui.scene)]),
        h('button', {
          class: 'vn-icon',
          title: '保存进度',
          'aria-label': '保存进度',
          onclick: () => {
            if (callbacks.onSave) callbacks.onSave();
          },
        }, ['💾']),
        h('button', {
          class: 'vn-icon',
          title: '剧情回放',
          'aria-label': '剧情回放',
          onclick: () => showBacklog(),
        }, ['📖']),
        h('button', {
          class: 'vn-icon',
          title: '菜单',
          'aria-label': '打开菜单',
          onclick: () => openMenu(),
        }, ['☰']),
      ]),
      h('button', {
        class: 'vn-hud__name',
        type: 'button',
        title: '查看角色信息',
        'aria-label': '查看角色信息',
        onclick: () => showProfile(),
      }, [
        h('span', { class: 'vn-hud__avatar' }, [(player.name || '你').slice(0, 1)]),
        h('span', {}, [player.name || '无名']),
        h('small', {}, [findCollegeName(player.collegeId)]),
        h('span', { class: 'vn-hud__more' }, ['›']),
      ]),
    ]);
  }

  function dialogueBox(speaker, text, effects) {
    const body = h('p', { class: 'vn-text' });
    typeText(body, text || '');
    const chips = (effects && effects.length)
      ? h('div', { class: 'vn-effects' }, effects.map((c) =>
          h('span', { class: 'vn-effect vn-effect--' + c.kind }, [c.text])
        ))
      : null;
    return h('div', { class: 'vn-dialogue' }, [
      h('div', { class: 'vn-dialogue__box' }, [
        speaker ? h('div', { class: 'vn-speaker' }, [speaker]) : null,
        body,
        chips,
      ]),
      h('div', { class: 'vn-next' }, ['▼']),
    ]);
  }

  function lockReason(action, av) {
    if (!av || av.ok) return '';
    if (av.reason === 'AP') return '行动点不足';
    if (av.reason === 'health') return '需要健康 ≥ ' + (action.requiresHealth || 0);
    if (av.reason === 'unknown_action') return '未知行动';
    return '当前不可用';
  }

  function choiceButton(opts) {
    return h('button', {
      class:
        'vn-choice' +
        (opts.variant ? ' vn-choice--' + opts.variant : '') +
        (opts.locked ? ' is-locked' : ''),
      disabled: !!opts.locked,
      title: opts.title || '',
      onclick: () => {
        if (!opts.locked && opts.onClick) opts.onClick();
      },
    }, [
      h('span', { class: 'vn-choice__label' }, [opts.label]),
      opts.meta ? h('span', { class: 'vn-choice__meta' }, [opts.meta]) : null,
    ]);
  }

  function actionChoices(state, availability) {
    const actions = listOf('actions');
    const apLeft = Number(state.actionPoints) || 0;
    const items = [];
    for (const a of actions) {
      const av = (availability && availability[a.id]) || { ok: true };
      const locked = !av.ok;
      const chips = effectChips(a.effects);
      const meta = locked
        ? lockReason(a, av)
        : (chips.length ? chips.map((c) => c.text).join(' · ') : '消耗 ' + (a.cost != null ? a.cost : 0) + ' 行动点');
      items.push(
        choiceButton({
          label: a.name || a.id,
          meta: meta,
          locked: locked,
          title: a.desc || a.name || a.id,
          onClick: () => {
            if (callbacks.onAction) callbacks.onAction(a.id);
          },
        })
      );
    }
    if (apLeft <= 0) {
      items.length = 0;
      items.push(
        choiceButton({
          label: NEXT_WEEK_TEXT,
          meta: '行动点已用完',
          variant: 'gold',
          onClick: () => {
            if (callbacks.onAdvance) callbacks.onAdvance();
          },
        })
      );
    }
    return h('div', { class: 'vn-choices' }, items);
  }

  // ---------------- 主视图 ----------------
  function syncDialogue(state, view) {
    const player = state.player || {};
    const seq = view && Number.isFinite(view.actionSeq) ? view.actionSeq : 0;
    const actionId = view && view.actionId;

    if (actionId && seq && seq !== ui.consumedSeq) {
      ui.consumedSeq = seq;
      ui.scene = ACTION_SCENE[actionId] || ui.scene;
      const lines = ACTION_FLAVOR[actionId] || [];
      const text = lines.length ? lines[seq % lines.length] : '（时间悄悄过去了）';
      const action = findAction(actionId);
      ui.speaker = player.name || '你';
      ui.text = text;
      ui.effects = effectChips(action && action.effects);
      ui.history.push({ who: ui.speaker, text: text });
    } else if (state.turn !== ui.lastTurn) {
      const first = ui.lastTurn === 0;
      ui.lastTurn = state.turn;
      ui.scene = 'campus';
      ui.speaker = '旁白';
      ui.text = first
        ? (state.turn > 1
            ? '（第 ' + state.turn + ' 周，故事继续）'
            : '（拖着行李箱走进校门，「川大」两个字在阳光下发亮）')
        : weekLine(state.turn);
      ui.effects = [];
      ui.history.push({ who: ui.speaker, text: ui.text });
    }
    if (ui.history.length > 200) ui.history.splice(0, ui.history.length - 200);
  }

  function applyStateAppearance(state) {
    const chosen = state && state.player && state.player.appearance;
    if (typeof chosen === 'string' && chosen) {
      ui.appearanceId = resolveAppearanceId(chosen);
    }
  }

  function render(state, view) {
    if (!state || !rootEl) return;
    closeOverlay();
    stopTypewriter();
    clearRoot();
    lastState = state;
    applyStateAppearance(state);
    syncDialogue(state, view || {});
    const v = view || {};
    const appearance = findAppearance(ui.appearanceId);

    rootEl.appendChild(
      h('div', { class: 'vn-stage' }, [
        bgLayer(ui.scene),
        spriteLayer(appearance),
        hud(state, v),
        actionChoices(state, v.availability),
        dialogueBox(ui.speaker, ui.text, ui.effects),
      ])
    );
  }

  // ---------------- 标题页 ----------------
  function titleScreen(hasSave) {
    return h('div', { class: 'vn-stage vn-stage--title' }, [
      bgLayer('title'),
      h('div', { class: 'vn-title' }, [
        h('div', { class: 'vn-title__crest' }, ['SCU']),
        h('h1', { class: 'vn-logo' }, ['川大校园生活模拟器']),
        h('p', { class: 'vn-logo__sub' }, ['SCUSim · 从入学到毕业的四十个星期']),
        h('div', { class: 'vn-title__menu' }, [
          h('button', {
            class: 'vn-menu-btn vn-menu-btn--primary',
            onclick: () => startCreation(),
          }, [
            h('span', { class: 'vn-menu-btn__label' }, ['开始新游戏']),
            h('span', { class: 'vn-menu-btn__hint' }, ['从大一新生开始']),
          ]),
          h('button', {
            class: 'vn-menu-btn' + (hasSave ? '' : ' is-locked'),
            disabled: !hasSave,
            onclick: () => {
              if (hasSave && callbacks.onLoadGame) callbacks.onLoadGame();
            },
          }, [
            h('span', { class: 'vn-menu-btn__label' }, ['继续游戏']),
            h('span', { class: 'vn-menu-btn__hint' }, [hasSave ? '读取本机存档' : '暂无存档']),
          ]),
          h('button', {
            class: 'vn-menu-btn',
            onclick: () => {
              if (callbacks.onOpenGallery) callbacks.onOpenGallery();
            },
          }, [
            h('span', { class: 'vn-menu-btn__label' }, ['结局图鉴']),
            h('span', { class: 'vn-menu-btn__hint' }, ['已解锁的毕业结局']),
          ]),
          h('button', {
            class: 'vn-menu-btn',
            onclick: () => {
              if (callbacks.onOpenSettings) callbacks.onOpenSettings();
            },
          }, [
            h('span', { class: 'vn-menu-btn__label' }, ['系统设置']),
            h('span', { class: 'vn-menu-btn__hint' }, ['立绘 / 动效 / 存档']),
          ]),
        ]),
        h('div', { class: 'vn-title__foot' }, [
          h('label', { class: 'vn-link' }, [
            '导入存档',
            h('input', {
              type: 'file',
              accept: '.scusim,application/json',
              style: 'display:none;',
              onchange: (e) => {
                const f = e && e.target && e.target.files && e.target.files[0];
                if (f && callbacks.onImport) callbacks.onImport(f);
              },
            }),
          ]),
          h('span', { class: 'vn-title__ver' }, ['v1.0 · 纯前端单机 · 存档在本机']),
        ]),
      ]),
    ]);
  }

  function renderTitle(hasSave) {
    closeOverlay();
    stopTypewriter();
    clearRoot();
    ui.scene = 'title';
    rootEl.appendChild(titleScreen(!!hasSave));
  }

  function mount(el, options) {
    rootEl = el;
    const opts = options || {};
    bindKeys();
    renderTitle(!!opts.hasSave);
  }

  function bindKeys() {
    if (keysBound) return;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    keysBound = true;
    doc.addEventListener('keydown', (e) => {
      if (!e || e.key == null) return;
      if (e.key === 'Escape' && overlayEl) closeOverlay();
    });
  }

  // ---------------- 创建角色 ----------------
  function makeCreationState() {
    const firstCollege = listOf('colleges')[0];
    return {
      step: 1,
      name: '',
      gender: '男',
      collegeId: firstCollege ? firstCollege.id : '',
      attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
      tags: [],
      appearanceId: defaultAppearanceFor('男'),
    };
  }

  let creation = makeCreationState();

  function stepper(step) {
    const labels = ['名字', '性别', '学院', '属性', '标签', '立绘'];
    return h('div', { class: 'vn-stepper' }, labels.map((label, i) =>
      h('div', {
        class:
          'vn-step' +
          (i + 1 < step ? ' is-done' : '') +
          (i + 1 === step ? ' is-current' : ''),
      }, [h('i', {}, [String(i + 1)]), h('span', {}, [label])])
    ));
  }

  function creationPreview() {
    const app = findAppearance(creation.appearanceId);
    const art = spriteArtStyle(app);
    return h('aside', { class: 'vn-create__preview' }, [
      h('div', { class: 'vn-create__preview-stage' }, [
        bgLayer('campus'),
        h('div', { class: 'vn-preview-sprite' }, [
          art
            ? h('div', { class: 'vn-sprite__art', style: art })
            : h('div', { class: 'vn-sprite__frame vn-sprite__frame--preview' }, [
                h('span', {
                  class: 'vn-sprite__tint',
                  style: 'background:linear-gradient(180deg,' + app.c1 + ' 0%,' + app.c2 + ' 100%)',
                }),
                h('span', { class: 'vn-sprite__hint' }, ['立绘预览']),
                h('span', { class: 'vn-sprite__name' }, [app.name]),
              ]),
        ]),
      ]),
      h('div', { class: 'vn-create__summary' }, [
        h('div', { class: 'vn-create__name', id: 'vn-preview-name' }, [
          creation.name || '（还没有名字）',
        ]),
        h('div', { class: 'vn-create__meta' }, [
          creation.gender + ' · ' + findCollegeName(creation.collegeId),
        ]),
        h('div', { class: 'vn-create__attrs' }, ATTRIBUTE_META.map((m) =>
          h('span', { class: 'vn-create__attr' }, [
            m.icon + ' ' + m.name + ' ' + (Number(creation.attributes[m.key]) || 0),
          ])
        )),
        h('div', { class: 'vn-create__tags' }, creation.tags.length
          ? creation.tags.map((t) => h('span', { class: 'pill pill--accent' }, [findTagName(t)]))
          : [h('span', { class: 'tiny muted' }, ['尚未选择标签'])]) ,
      ]),
    ]);
  }

  function creationNameStep() {
    const input = h('input', {
      class: 'input input--vn',
      type: 'text',
      placeholder: '例如：林晞',
      value: creation.name,
      maxlength: '16',
    });
    input.addEventListener('input', (e) => {
      creation.name = e.target ? e.target.value : '';
      const node = doc.getElementById && doc.getElementById('vn-preview-name');
      if (node) node.textContent = creation.name || '（还没有名字）';
    });
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['你的名字']),
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label' }, ['姓名']),
        input,
      ]),
      h('button', {
        class: 'btn btn--primary btn--block btn--lg',
        onclick: () => {
          const n = (creation.name || '').trim();
          if (!n) {
            showError('请输入姓名');
            return;
          }
          creation.name = n;
          creation.step = 2;
          renderCreation();
        },
      }, ['下一步 →']),
    ]);
  }

  function creationGenderStep() {
    const options = ['男', '女'];
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['性别']),
      h('p', { class: 'vn-form__desc' }, ['决定可选立绘的范围，随时可以在设置里更换。']),
      h('div', { class: 'vn-opt-grid' }, options.map((g) =>
        h('button', {
          class: 'vn-opt vn-opt--plain' + (creation.gender === g ? ' is-selected' : ''),
          onclick: () => {
            creation.gender = g;
            creation.appearanceId = defaultAppearanceFor(g);
            renderCreation();
          },
        }, [
          h('span', { class: 'vn-opt__name' }, [g === '男' ? '男 · 少年' : '女 · 少女']),
        ])
      )),
      h('button', {
        class: 'btn btn--primary btn--block btn--lg',
        onclick: () => {
          creation.step = 3;
          renderCreation();
        },
      }, ['下一步 →']),
    ]);
  }

  function creationCollegeStep() {
    const colleges = listOf('colleges');
    const select = h(
      'select',
      { class: 'select input--vn' },
      colleges.map((c) =>
        h('option', { value: c.id, selected: c.id === creation.collegeId }, [c.name])
      )
    );
    select.addEventListener('change', (e) => {
      creation.collegeId = e.target ? e.target.value : creation.collegeId;
      renderCreation();
    });
    const cur = findCollege(creation.collegeId);
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['学院']),
      h('p', { class: 'vn-form__desc' }, ['每个学院的气质不太一样。']),
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label' }, ['学院']),
        select,
      ]),
      cur ? h('div', { class: 'vn-form__note' }, ['「' + cur.name + '」— ' + (cur.desc || '')]) : null,
      h('button', {
        class: 'btn btn--primary btn--block btn--lg',
        onclick: () => {
          if (!creation.collegeId) {
            showError('请选择学院');
            return;
          }
          creation.step = 4;
          renderCreation();
        },
      }, ['下一步 →']),
    ]);
  }

  function creationAttributeStep() {
    const used = ATTRIBUTE_META.reduce(
      (s, m) => s + (Number(creation.attributes[m.key]) || 0),
      0
    );
    const remain = TOTAL_POINTS - used;
    const rows = ATTRIBUTE_META.map((m) => {
      const val = Number(creation.attributes[m.key]) || 0;
      const minus = h('button', {
        class: 'vn-step-btn',
        onclick: () => {
          if (val > 0) {
            creation.attributes[m.key] = val - 1;
            renderCreation();
          }
        },
      }, ['−']);
      const plus = h('button', {
        class: 'vn-step-btn',
        onclick: () => {
          if (remain > 0) {
            creation.attributes[m.key] = val + 1;
            renderCreation();
          }
        },
      }, ['+']);
      return h('div', { class: 'vn-attr-row' }, [
        h('span', { class: 'vn-attr-name' }, [m.icon + ' ' + m.name]),
        h('div', { class: 'vn-attr-ctrl' }, [minus, h('b', {}, [String(val)]), plus]),
      ]);
    });
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['属性']),
      h('p', { class: 'vn-form__desc' }, [
        '把 ' + TOTAL_POINTS + ' 点分到四项上，分配完才能继续。',
      ]),
      h('div', { class: 'vn-attr-list' }, rows),
      h('div', { class: 'vn-counter' + (remain === 0 ? ' is-ok' : '') }, [
        '剩余 ' + remain + ' 点',
      ]),
      h('button', {
        class: 'btn btn--primary btn--block btn--lg' + (remain === 0 ? '' : ' is-disabled'),
        disabled: remain !== 0,
        onclick: () => {
          if (remain === 0) {
            creation.step = 5;
            renderCreation();
          }
        },
      }, ['下一步 →']),
    ]);
  }

  function creationTagStep() {
    const tags = listOf('tags');
    const selected = creation.tags;
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['性格标签']),
      h('p', { class: 'vn-form__desc' }, ['挑 ' + REQUIRED_TAGS + ' 个词，定义你的大学四年。']),
      h('div', { class: 'vn-tag-grid' }, tags.map((t) => {
        const sel = selected.indexOf(t.id) >= 0;
        return h('button', {
          class: 'vn-tag' + (sel ? ' is-selected' : ''),
          onclick: () => {
            if (sel) {
              creation.tags = creation.tags.filter((x) => x !== t.id);
            } else if (creation.tags.length < REQUIRED_TAGS) {
              creation.tags.push(t.id);
            } else {
              showError('最多选择 ' + REQUIRED_TAGS + ' 个标签');
              return;
            }
            renderCreation();
          },
        }, [
          h('b', {}, [t.name || t.id]),
          h('small', {}, [t.desc || '']),
        ]);
      })),
      h('div', { class: 'vn-counter' + (selected.length === REQUIRED_TAGS ? ' is-ok' : '') }, [
        '已选 ' + selected.length + ' / ' + REQUIRED_TAGS,
      ]),
      h('button', {
        class:
          'btn btn--primary btn--block btn--lg' +
          (selected.length === REQUIRED_TAGS ? '' : ' is-disabled'),
        disabled: selected.length !== REQUIRED_TAGS,
        onclick: () => {
          if (selected.length !== REQUIRED_TAGS) {
            showError('请选择 ' + REQUIRED_TAGS + ' 个标签');
            return;
          }
          creation.step = 6;
          renderCreation();
        },
      }, ['下一步 →']),
    ]);
  }

  function creationAppearanceStep() {
    const list = APPEARANCES.slice().sort((a, b) => {
      const ga = a.gender === creation.gender ? 0 : 1;
      const gb = b.gender === creation.gender ? 0 : 1;
      return ga - gb;
    });
    return h('div', { class: 'vn-form' }, [
      h('h2', { class: 'vn-form__title' }, ['选择立绘']),
      h('p', { class: 'vn-form__desc' }, ['选一个你喜欢的形象。']),
      h('div', { class: 'vn-opt-grid' }, list.map((app) => {
        const sel = creation.appearanceId === app.id;
        const art = spriteArtStyle(app);
        return h('button', {
          class: 'vn-opt' + (sel ? ' is-selected' : ''),
          onclick: () => {
            creation.appearanceId = app.id;
            renderCreation();
          },
        }, [
          h('span', { class: 'vn-opt__art' }, [
            art
              ? h('span', { class: 'vn-opt__art-img', style: art })
              : h('span', {
                  class: 'vn-opt__art-tone',
                  style: 'background:linear-gradient(160deg,' + app.c1 + ',' + app.c2 + ')',
                }),
          ]),
          h('span', { class: 'vn-opt__name' }, [app.name]),
          h('span', { class: 'vn-opt__flag' }, [app.gender + ' · ' + (sel ? '已选择' : '点击选择')]),
        ]);
      })),
      h('button', {
        class: 'btn btn--primary btn--block btn--lg',
        onclick: () => submitCreation(),
      }, ['开始大学生活 →']),
    ]);
  }

  function creationFooter() {
    return h('div', { class: 'vn-create__foot' }, [
      creation.step > 1
        ? h('button', {
            class: 'btn btn--ghost',
            onclick: () => {
              creation.step -= 1;
              renderCreation();
            },
          }, ['← 上一步'])
        : h('button', {
            class: 'btn btn--ghost',
            onclick: () => {
              if (callbacks.onOpenMenu) callbacks.onOpenMenu();
            },
          }, ['返回标题']),
      h('span', { class: 'tiny muted' }, ['第 ' + creation.step + ' / 6 步']),
    ]);
  }

  function submitCreation() {
    const opts = {
      name: creation.name,
      gender: creation.gender,
      collegeId: creation.collegeId,
      attributes: {
        knowledge: Number(creation.attributes.knowledge) || 0,
        social: Number(creation.attributes.social) || 0,
        health: Number(creation.attributes.health) || 0,
        money: Number(creation.attributes.money) || 0,
      },
      tags: creation.tags.slice(0, REQUIRED_TAGS),
      appearance: creation.appearanceId,
    };
    if (callbacks.onNewGame) callbacks.onNewGame(opts);
  }

  function renderCreation() {
    closeOverlay();
    stopTypewriter();
    clearRoot();
    ui.appearanceId = creation.appearanceId;
    let body;
    switch (creation.step) {
      case 1: body = creationNameStep(); break;
      case 2: body = creationGenderStep(); break;
      case 3: body = creationCollegeStep(); break;
      case 4: body = creationAttributeStep(); break;
      case 5: body = creationTagStep(); break;
      default: body = creationAppearanceStep(); break;
    }
    rootEl.appendChild(
      h('div', { class: 'vn-stage vn-stage--creation' }, [
        bgLayer('campus'),
        h('div', { class: 'vn-create' }, [
          creationPreview(),
          h('section', { class: 'vn-create__panel' }, [
            h('div', { class: 'vn-create__head' }, [
              h('h1', { class: 'vn-create__title' }, ['创建角色']),
              stepper(creation.step),
            ]),
            h('div', { class: 'vn-create__body' }, [body]),
            creationFooter(),
          ]),
        ]),
      ])
    );
  }

  function startCreation() {
    creation = makeCreationState();
    renderCreation();
  }

  // ---------------- 弹层：菜单抽屉 ----------------
  function openMenu() {
    const items = [
      { label: '保存进度', hint: '写入本机存档', run: () => { if (callbacks.onSave) callbacks.onSave(); } },
      { label: '读取进度', hint: '回到最近一次存档', run: () => { if (callbacks.onLoadGame) callbacks.onLoadGame(); } },
      { label: '剧情回放', hint: '重看本周的对话', run: () => showBacklog() },
      { label: '系统设置', hint: '立绘 / 动效', run: () => { if (callbacks.onOpenSettings) callbacks.onOpenSettings(); } },
      { label: '商城', hint: '敬请期待', locked: true, run: () => showToast('商城还没开门呢', 'warning') },
    ];
    const scrim = h('div', {
      class: 'vn-scrim',
      onclick: (e) => {
        if (e.target === scrim) closeOverlay();
      },
    }, [
      h('aside', { class: 'vn-drawer' }, [
        h('div', { class: 'vn-drawer__head' }, [
          h('span', { class: 'vn-drawer__title' }, ['菜单']),
          h('button', { class: 'vn-icon vn-icon--close', onclick: () => closeOverlay() }, ['×']),
        ]),
        h('div', { class: 'vn-drawer__body' }, items.map((it) =>
          h('button', {
            class: 'vn-menu-btn' + (it.locked ? ' is-locked' : ''),
            onclick: () => {
              closeOverlay();
              it.run();
            },
          }, [
            h('span', { class: 'vn-menu-btn__label' }, [it.label]),
            h('span', { class: 'vn-menu-btn__hint' }, [it.hint]),
          ])
        )),
        h('div', { class: 'vn-drawer__foot' }, [
          h('button', {
            class: 'vn-link',
            onclick: () => {
              closeOverlay();
              if (callbacks.onOpenMenu) callbacks.onOpenMenu();
            },
          }, ['返回标题']),
          h('button', {
            class: 'vn-link',
            onclick: () => {
              closeOverlay();
              if (callbacks.onExport) callbacks.onExport();
            },
          }, ['导出存档']),
          h('button', {
            class: 'vn-link',
            onclick: () => {
              closeOverlay();
              if (callbacks.onClearSave) callbacks.onClearSave();
            },
          }, ['清除存档']),
        ]),
        h('div', { class: 'vn-drawer__credit' }, ['SCUSim · 校园生活模拟器']),
      ]),
    ]);
    mountOverlay(scrim);
  }

  // ---------------- 弹层：事件（VN 对话 + 选项） ----------------
  function showEvent(ev) {
    if (!ev || !rootEl) return;
    closeOverlay();
    const def = findEventById(ev.eventId) || {};
    const title = def.name || ev.eventId || '事件';
    const body = def.text || '';
    const options = Array.isArray(ev.options) && ev.options.length
      ? ev.options
      : (Array.isArray(def.options) ? def.options : []);

    const node = h('div', { class: 'vn-event' }, [
      h('div', { class: 'vn-event__scrim' }),
      h('div', { class: 'vn-event__inner' }, [
        h('div', { class: 'vn-event__tag' }, ['✦ ' + title]),
        h('div', { class: 'vn-choices vn-choices--event' }, options.map((o) =>
          choiceButton({
            label: o.label || o.id,
            onClick: () => {
              if (callbacks.onResolveEvent) callbacks.onResolveEvent(o.id);
            },
          })
        )),
        dialogueBox(title, body, []),
      ]),
    ]);
    mountOverlay(node);
    markStageEvent(true);
  }

  // ---------------- 弹层：结局 ----------------
  function showEnding(e) {
    if (!e || !rootEl) return;
    closeOverlay();
    const state = lastState || {};
    const attrs = (state.player && state.player.attributes) || {};
    const node = h('div', { class: 'vn-ending' }, [
      h('div', { class: 'vn-ending__card' }, [
        h('div', { class: 'vn-ending__rank' }, ['🎓 毕业结局']),
        h('h2', { class: 'vn-ending__name' }, [e.name || '结局']),
        h('p', { class: 'vn-ending__desc' }, [e.desc || '']),
        h('div', { class: 'vn-ending__stats' }, ATTRIBUTE_META.map((m) =>
          h('span', { class: 'vn-ending__stat' }, [
            m.icon + ' ' + m.name + ' ' + (Number(attrs[m.key]) || 0),
          ])
        )),
        h('div', { class: 'vn-ending__actions' }, [
          h('button', {
            class: 'btn btn--primary btn--block btn--lg',
            onclick: () => {
              closeOverlay();
              if (callbacks.onOpenMenu) callbacks.onOpenMenu();
            },
          }, ['返回标题']),
          h('button', {
            class: 'btn btn--secondary btn--block',
            onclick: () => {
              closeOverlay();
              startCreation();
            },
          }, ['再玩一次']),
        ]),
      ]),
    ]);
    mountOverlay(node);
  }

  // ---------------- 弹层：通用 ----------------
  function modalShell(title, bodyChildren, footChildren, wide) {
    return h('div', {
      class: 'vn-modal-scrim',
      onclick: (ev) => {
        const self = ev && ev.target;
        if (self && self.className && String(self.className).indexOf('vn-modal-scrim') === 0) {
          closeOverlay();
        }
      },
    }, [
      h('div', { class: 'vn-modal' + (wide ? ' vn-modal--wide' : '') }, [
        h('div', { class: 'vn-modal__head' }, [
          h('h3', { class: 'vn-modal__title' }, [title]),
          h('button', { class: 'vn-icon vn-icon--close', onclick: () => closeOverlay() }, ['×']),
        ]),
        h('div', { class: 'vn-modal__body' }, bodyChildren),
        footChildren ? h('div', { class: 'vn-modal__foot' }, footChildren) : null,
      ]),
    ]);
  }

  function showGallery(g) {
    if (!rootEl) return;
    closeOverlay();
    const unlocked = g && Array.isArray(g.unlocked) ? g.unlocked : [];
    const list = listOf('endings');
    const items = list.map((e) => {
      const got = unlocked.indexOf(e.id) >= 0;
      return h('div', { class: 'vn-gallery__item' + (got ? '' : ' is-locked') }, [
        h('div', { class: 'vn-gallery__row' }, [
          h('b', {}, [got ? (e.name || e.id) : '？？？']),
          h('span', { class: 'vn-gallery__flag' }, [got ? '已解锁' : '未解锁']),
        ]),
        h('p', { class: 'vn-gallery__desc' }, [
          got ? (e.desc || '') : '继续游玩以解锁。',
        ]),
      ]);
    });
    const body = [
      h('p', { class: 'vn-modal__lead' }, [
        '已解锁 ' + unlocked.length + ' / ' + list.length + ' 个结局',
      ]),
      h('div', { class: 'vn-gallery' }, items),
    ];
    mountOverlay(
      modalShell('结局图鉴', body, [
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => closeOverlay() }, ['关闭']),
      ], true)
    );
  }

  // ---------------- 弹层：角色信息（点 HUD 姓名牌打开） ----------------
  function showProfile() {
    if (!rootEl || !lastState) return;
    closeOverlay();
    const state = lastState;
    const player = state.player || {};
    const attrs = player.attributes || {};
    const appearance = findAppearance(ui.appearanceId);
    const maxTurn = balanceOf('turns', 40);
    const apMax = balanceOf('actionPointsPerTurn', 4);
    const academics = state.academics || {};
    const scores = Array.isArray(academics.semesterScores) ? academics.semesterScores : [];
    const avg = scores.length
      ? Math.round(scores.reduce((s, v) => s + (Number(v) || 0), 0) / scores.length)
      : null;
    const failed = Number(academics.failedCourses) || 0;
    const study = Number(academics.studyActions) || 0;

    const bars = ATTRIBUTE_META.map((m) => {
      const val = Number(attrs[m.key]) || 0;
      const pct = Math.max(0, Math.min(100, (Math.max(0, val) / ATTR_DISPLAY_MAX) * 100));
      return h('div', { class: 'stat' }, [
        h('div', { class: 'stat__head' }, [
          h('span', { class: 'stat__name' }, [m.icon + ' ' + m.name]),
          h('span', { class: 'stat__value' }, [String(val)]),
        ]),
        h('div', { class: 'stat__track' }, [
          h('div', { class: 'stat__fill', style: 'width:' + pct + '%' }),
        ]),
      ]);
    });

    const cell = (k, v) => h('div', { class: 'vn-profile__cell' }, [
      h('div', { class: 'vn-profile__k' }, [k]),
      h('div', { class: 'vn-profile__v' }, [String(v)]),
    ]);

    const body = [
      h('div', { class: 'vn-profile__head' }, [
        h('span', { class: 'vn-profile__avatar' }, [(player.name || '你').slice(0, 1)]),
        h('div', {}, [
          h('div', { class: 'vn-profile__name' }, [player.name || '无名']),
          h('div', { class: 'vn-profile__sub' }, [
            findCollegeName(player.collegeId) + ' · ' + (player.gender || '') + ' · ' + appearance.name,
          ]),
        ]),
      ]),
      h('div', { class: 'vn-profile__grid' }, bars),
      h('div', { class: 'vn-profile__tags' }, (player.tags || []).map((t) =>
        h('span', { class: 'pill pill--accent' }, [findTagName(t)])
      )),
      h('div', { class: 'vn-profile__meta' }, [
        cell('学年学期', semesterLabel(state.turn)),
        cell('回合', state.turn + ' / ' + maxTurn),
        cell('行动点', (state.actionPoints || 0) + ' / ' + apMax),
        cell('学习行动', study + ' 次'),
        cell('考试均分', avg == null ? '—' : avg),
        cell('挂科', failed + ' 门'),
      ]),
    ];

    mountOverlay(
      modalShell('角色信息', body, [
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => closeOverlay() }, ['关闭']),
      ], true)
    );
  }

  function showBacklog() {
    if (!rootEl) return;
    closeOverlay();
    const lines = ui.history.slice(-80).reverse();
    const state = lastState || {};
    const logs = Array.isArray(state.log) ? state.log.slice(-12).reverse() : [];
    const body = [
      h('div', { class: 'vn-backlog' }, lines.length
        ? lines.map((l) => h('div', { class: 'vn-backlog__item' }, [
            h('span', { class: 'vn-backlog__who' }, [l.who || '旁白']),
            h('p', { class: 'vn-backlog__text' }, [l.text]),
          ]))
        : [h('p', { class: 'tiny muted' }, ['还没有可回放的对话。'])]),
      logs.length ? h('div', { class: 'vn-backlog__logs' }, [
        h('div', { class: 'vn-modal__lead' }, ['行动记录']),
        ...logs.map((t) => h('p', { class: 'tiny muted' }, ['· ' + t])),
      ]) : null,
    ];
    mountOverlay(
      modalShell('剧情回放', body, [
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => closeOverlay() }, ['关闭']),
      ], true)
    );
  }

  function showSettings(settings, onSave) {
    if (!rootEl) return;
    closeOverlay();
    const s = settings || { seedDisplay: false, reduceMotion: false, lastSaveAt: 0 };
    let reduceMotion = !!s.reduceMotion;
    const chosen = resolveAppearanceId(ui.appearanceId);
    let appearanceId = typeof s.appearance === 'string' && s.appearance
      ? resolveAppearanceId(s.appearance)
      : chosen;

    const motionBtn = h('button', {
      class: 'vn-switch' + (reduceMotion ? ' is-on' : ''),
      onclick: () => {
        reduceMotion = !reduceMotion;
        motionBtn.className = 'vn-switch' + (reduceMotion ? ' is-on' : '');
        motionBtn.textContent = reduceMotion ? '已开启（减弱动效）' : '已关闭';
      },
    }, [reduceMotion ? '已开启（减弱动效）' : '已关闭']);

    const optionNodes = [];
    const grid = h('div', { class: 'vn-opt-grid vn-opt-grid--tight' }, APPEARANCES.map((app) => {
      const art = spriteArtStyle(app);
      const node = h('button', {
        class: 'vn-opt vn-opt--sm' + (app.id === appearanceId ? ' is-selected' : ''),
        onclick: () => {
          appearanceId = app.id;
          for (const n of optionNodes) n.className = 'vn-opt vn-opt--sm';
          node.className = 'vn-opt vn-opt--sm is-selected';
        },
      }, [
        h('span', { class: 'vn-opt__art' }, [
          art
            ? h('span', { class: 'vn-opt__art-img', style: art })
            : h('span', {
                class: 'vn-opt__art-tone',
                style: 'background:linear-gradient(160deg,' + app.c1 + ',' + app.c2 + ')',
              }),
        ]),
        h('span', { class: 'vn-opt__name' }, [app.name]),
      ]);
      optionNodes.push(node);
      return node;
    }));

    const body = [
      h('div', { class: 'vn-setting' }, [
        h('div', { class: 'vn-setting__label' }, ['减弱动效']),
        motionBtn,
      ]),
      h('div', { class: 'vn-setting' }, [
        h('div', { class: 'vn-setting__label' }, ['我的立绘']),
        h('p', { class: 'tiny muted' }, ['换装只在存档里生效，随时可以改。']),
        grid,
      ]),
    ];
    mountOverlay(
      modalShell('系统设置', body, [
        h('button', {
          class: 'btn btn--primary btn--block',
          onclick: () => {
            ui.reduceMotion = reduceMotion;
            closeOverlay();
            if (callbacks.onChangeAppearance) callbacks.onChangeAppearance(appearanceId);
            if (onSave) onSave({ reduceMotion: reduceMotion, appearance: appearanceId });
          },
        }, ['保存']),
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => closeOverlay() }, ['取消']),
      ], true)
    );
  }

  // ---------------- 提示 ----------------
  function showToast(msg, kind) {
    if (!msg || !rootEl) return;
    const toast = h('div', { class: 'vn-toast' + (kind ? ' vn-toast--' + kind : '') }, [String(msg)]);
    rootEl.appendChild(toast);
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 2400);
    }
  }

  function showError(msg) {
    showToast(msg, 'danger');
  }

  // ---------------- 对外接口 ----------------
  return {
    mount,
    render,
    showEvent,
    showEnding,
    showError,
    showToast,
    showGallery,
    showSettings,
    showBacklog,
    openMenu,
    closeOverlay,
    startCreation,
    setAppearance(id) {
      ui.appearanceId = resolveAppearanceId(id);
      if (lastState) render(lastState, null);
    },
  };
}
