/**
 * SCUSim · UI 表现层（负责人 C · 寇豆码）
 *
 * 设计红线（与 M1 一致）：
 *  - 本文件【零 import】。不引入 src/core/ src/events/ src/storage/ src/config/ 任何模块。
 *  - 所有状态变更【只经 callbacks】，绝不直接改写 GameState。
 *  - 允许触碰 DOM（表现层）；文档对象通过 ctx.doc 注入（浏览器传 document，测试传桩）。
 *
 * createApp({ config, callbacks, doc? }) -> {
 *   mount(rootEl, options?), render(state, view?), showEvent(ev),
 *   showEnding(e), showError(msg), showGallery(g), showSettings(settings, onSave),
 *   startCreation()
 * }
 */

// 属性展示元数据（顺序与 KEY 固定）
const ATTRIBUTE_META = [
  { key: 'knowledge', name: '📚 学识' },
  { key: 'social', name: '💬 社交' },
  { key: 'health', name: '❤️ 健康' },
  { key: 'money', name: '💰 金钱' },
];

const TOTAL_POINTS = 20; // 属性分配总和硬约束
const REQUIRED_TAGS = 3; // 标签数量硬约束
const HEALTH_BAD = 3; // 健康 <= 该值显示危险色
const HEALTH_WARN = 8; // 健康 <= 该值显示警告色
const ATTR_DISPLAY_MAX = 60; // 属性条填充百分比的展示上限

/**
 * 创建 UI 应用。
 * @param {object} ctx { config, callbacks, doc? }
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

  function closeOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  // ---------------- 配置查询辅助（纯数据查找，非 import） ----------------
  function findEventById(id) {
    const ev = config && config.events;
    if (!ev) return null;
    const all = [].concat(ev.fixed || [], ev.random || []);
    return all.find((e) => e.id === id) || null;
  }
  function findEndingById(id) {
    const list = config && config.endings && config.endings.list;
    if (!list) return null;
    return list.find((e) => e.id === id) || null;
  }
  function findCollegeName(id) {
    const list = config && config.colleges && config.colleges.list;
    if (!list) return id || '';
    const c = list.find((x) => x.id === id);
    return c ? c.name : id || '';
  }
  function findTagName(id) {
    const list = config && config.tags && config.tags.list;
    if (!list) return id || '';
    const t = list.find((x) => x.id === id);
    return t ? t.name : id || '';
  }

  // ---------------- 创建角色（四/五步流程，仅收集数据） ----------------
  function makeCreationState() {
    const firstCollege =
      config && config.colleges && config.colleges.list[0]
        ? config.colleges.list[0].id
        : '';
    return {
      step: 1,
      name: '',
      gender: '男',
      collegeId: firstCollege,
      attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
      tags: [],
    };
  }
  const creation = makeCreationState();

  function creationFooter() {
    return h('div', { class: 'row row--between' }, [
      creation.step > 1
        ? h('button', {
            class: 'btn btn--secondary',
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
          }, ['取消']),
      h('span', { class: 'tiny' }, ['按提示完成全部步骤']),
    ]);
  }

  function creationNameStep() {
    const input = h('input', {
      class: 'input',
      type: 'text',
      placeholder: '例如：李华',
      value: creation.name,
      maxlength: '16',
    });
    input.addEventListener('input', (e) => {
      creation.name = e.target ? e.target.value : '';
    });
    return h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['① 你的名字']),
      h('p', { class: 'muted' }, ['给自己取一个响亮的名字（1-16 字）。']),
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
    const genders = ['男', '女'];
    const pills = h(
      'div',
      { class: 'row' },
      genders.map((g) => {
        const sel = creation.gender === g;
        return h('span', {
          class: 'pill pill--selectable' + (sel ? ' pill--selected' : ''),
          onclick: () => {
            creation.gender = g;
            renderCreation();
          },
        }, [g]);
      })
    );
    return h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['② 性别']),
      h('p', { class: 'muted' }, ['选择你的性别。']),
      pills,
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
    const colleges = (config && config.colleges && config.colleges.list) || [];
    const select = h(
      'select',
      { class: 'select' },
      colleges.map((c) =>
        h('option', {
          value: c.id,
          selected: c.id === creation.collegeId,
        }, [c.name])
      )
    );
    select.addEventListener('change', (e) => {
      creation.collegeId = e.target ? e.target.value : creation.collegeId;
    });
    return h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['③ 学院']),
      h('p', { class: 'muted' }, ['选择你所在的学院。']),
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label' }, ['学院']),
        select,
      ]),
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
        class: 'btn btn-circle',
        onclick: () => {
          if (val > 0) {
            creation.attributes[m.key] = val - 1;
            renderCreation();
          }
        },
      }, ['－']);
      const plus = h('button', {
        class: 'btn btn-circle',
        onclick: () => {
          if (remain > 0) {
            creation.attributes[m.key] = val + 1;
            renderCreation();
          }
        },
      }, ['＋']);
      const valEl = h('span', {
        class: 'stat__value',
        style: 'min-width:28px;text-align:center;',
      }, [String(val)]);
      return h('div', { class: 'row row--between' }, [
        h('span', { class: 'stat__name' }, [m.name]),
        h('div', { class: 'row' }, [minus, valEl, plus]),
      ]);
    });
    const remainPill = h('span', {
      class: 'pill ' + (remain === 0 ? 'pill--success' : 'pill--warning'),
    }, ['剩余 ' + remain + ' 点']);
    return h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['④ 分配属性']),
      h('p', { class: 'muted' }, [
        '将 ' + TOTAL_POINTS + ' 点分配到四项属性，分配完才能继续。',
      ]),
      h('div', { class: 'stack' }, rows),
      h('div', { class: 'row' }, [remainPill]),
      h('button', {
        class:
          'btn btn--primary btn--block btn--lg' +
          (remain === 0 ? '' : ' is-disabled'),
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
    const tags = (config && config.tags && config.tags.list) || [];
    const selected = creation.tags;
    const pills = h(
      'div',
      { class: 'grid grid--auto' },
      tags.map((t) => {
        const sel = selected.indexOf(t.id) >= 0;
        return h('span', {
          class: 'pill pill--selectable' + (sel ? ' pill--selected' : ''),
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
        }, [t.name || t.id]);
      })
    );
    const counter = h('span', {
      class:
        'pill ' +
        (selected.length === REQUIRED_TAGS ? 'pill--success' : 'pill--warning'),
    }, ['已选 ' + selected.length + '/' + REQUIRED_TAGS]);
    return h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['⑤ 选择标签']),
      h('p', { class: 'muted' }, [
        '选择 ' + REQUIRED_TAGS + ' 个标签定义你的性格。',
      ]),
      pills,
      h('div', { class: 'row' }, [counter]),
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
          submitCreation();
        },
      }, ['✅ 完成创建']),
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
    };
    // 仅收集数据并通过回调上抛，UI 自身不改 GameState
    if (callbacks.onNewGame) callbacks.onNewGame(opts);
  }

  function renderCreation() {
    clearRoot();
    closeOverlay();
    let content;
    switch (creation.step) {
      case 1:
        content = creationNameStep();
        break;
      case 2:
        content = creationGenderStep();
        break;
      case 3:
        content = creationCollegeStep();
        break;
      case 4:
        content = creationAttributeStep();
        break;
      default:
        content = creationTagStep();
        break;
    }
    rootEl.appendChild(
      h('div', { class: 'screen screen--narrow stack-6', style: 'max-width:560px;margin:0 auto;' }, [
        h('header', { class: 'topbar' }, [
          h('div', { class: 'topbar__brand' }, ['🐼 创建角色']),
          h('div', { class: 'topbar__meta' }, [
            h('span', { class: 'pill pill--accent' }, ['第 ' + creation.step + '/5 步']),
          ]),
        ]),
        content,
        creationFooter(),
      ])
    );
  }

  function startCreation() {
    Object.assign(creation, makeCreationState());
    renderCreation();
  }

  // ---------------- 主菜单 ----------------
  function renderMenu(hasSave) {
    clearRoot();
    closeOverlay();
    const topbar = h('header', { class: 'topbar' }, [
      h('div', { class: 'topbar__brand' }, ['🐼 SCUSim']),
    ]);
    const menuCard = h('div', {
      class: 'card stack-6',
      style: 'max-width:480px;margin:24px auto;',
    }, [
      h('div', { class: 'stack-2' }, [
        h('h1', { class: 'section-title' }, ['川大校园生活模拟器']),
        h('p', { class: 'lead' }, ['从入学到毕业，你的大学你做主。']),
      ]),
      h('button', {
        class: 'btn btn--primary btn--block btn--lg',
        onclick: () => startCreation(),
      }, ['✨ 新游戏']),
      h('button', {
        class: 'btn btn--secondary btn--block' + (hasSave ? '' : ' is-disabled'),
        disabled: !hasSave,
        onclick: () => {
          if (hasSave && callbacks.onLoadGame) callbacks.onLoadGame();
        },
      }, ['📂 继续游戏' + (hasSave ? '' : '（无存档）')]),
      h('button', {
        class: 'btn btn--ghost btn--block',
        onclick: () => {
          if (callbacks.onOpenGallery) callbacks.onOpenGallery();
        },
      }, ['🏆 结局图鉴']),
      h('div', { class: 'row', style: 'gap:8px;' }, [
        h('button', {
          class: 'btn btn--ghost btn--block',
          onclick: () => {
            if (callbacks.onOpenSettings) callbacks.onOpenSettings();
          },
        }, ['⚙️ 设置']),
        h('label', { class: 'btn btn--ghost btn--block' }, [
          '📥 导入存档',
          h('input', {
            type: 'file',
            accept: '.scusim,application/json',
            style: 'display:none;',
            onchange: (e) => {
              const f =
                e && e.target && e.target.files && e.target.files[0];
              if (f && callbacks.onImport) callbacks.onImport(f);
            },
          }),
        ]),
      ]),
    ]);
    rootEl.appendChild(
      h('div', { class: 'screen stack-6' }, [topbar, menuCard])
    );
  }

  function mount(el, options) {
    rootEl = el;
    const opts = options || {};
    renderMenu(!!opts.hasSave);
  }

  // ---------------- 游戏主视图 ----------------
  function buildTopbar(state, maxTurn, apMax) {
    const semester = Math.ceil(state.turn / 5);
    const player = state.player || {};
    const name = player.name || '无名';
    const college = findCollegeName(player.collegeId);
    const dots = h(
      'span',
      { class: 'ap-dots' },
      Array.from({ length: apMax }, (_, i) =>
        h('i', { class: 'ap-dot' + (i < state.actionPoints ? ' is-on' : '') })
      )
    );
    return h('header', { class: 'topbar' }, [
      h('div', { class: 'topbar__brand' }, ['🐼 SCUSim']),
      h('div', { class: 'topbar__meta' }, [
        h('span', { class: 'pill pill--accent' }, [name]),
        h('span', { class: 'pill' }, [college]),
        h('span', { class: 'pill pill--accent' }, ['第 ' + semester + ' 学期']),
        h('span', { class: 'pill' }, ['回合 ' + state.turn + '/' + maxTurn]),
        h('span', { class: 'pill' }, ['行动点']),
        dots,
        h('button', {
          class: 'btn-circle',
          title: '导出存档',
          onclick: () => {
            if (callbacks.onExport) callbacks.onExport();
          },
        }, ['📤']),
        h('button', {
          class: 'btn-circle',
          title: '返回主菜单',
          onclick: () => {
            if (callbacks.onOpenMenu) callbacks.onOpenMenu();
          },
        }, ['🏠']),
      ]),
    ]);
  }

  function buildStat(meta, value) {
    let fillClass = '';
    if (meta.key === 'health') {
      if (value <= HEALTH_BAD) fillClass = ' stat__fill--bad';
      else if (value <= HEALTH_WARN) fillClass = ' stat__fill--warn';
    } else if (meta.key === 'money' && value < 0) {
      fillClass = ' stat__fill--bad';
    }
    const shown = Math.max(0, value);
    const pct = Math.max(0, Math.min(100, (shown / ATTR_DISPLAY_MAX) * 100));
    return h('div', { class: 'stat' }, [
      h('div', { class: 'stat__head' }, [
        h('span', { class: 'stat__name' }, [meta.name]),
        h('span', { class: 'stat__value' }, [String(value)]),
      ]),
      h('div', { class: 'stat__track' }, [
        h('div', {
          class: 'stat__fill' + fillClass,
          style: 'width:' + pct + '%',
        }),
      ]),
    ]);
  }

  function buildActions(state, availability) {
    const actions = (config && config.actions && config.actions.list) || [];
    const grid = h('div', { class: 'grid grid--auto' });
    for (const a of actions) {
      const av = (availability && availability[a.id]) || { ok: true };
      const disabled = !av.ok;
      grid.appendChild(
        h('button', {
          class: 'btn btn--primary btn--block' + (disabled ? ' is-disabled' : ''),
          disabled: disabled,
          title: disabled ? av.reason || '当前不可用' : a.desc || a.name,
          onclick: () => {
            if (!disabled && callbacks.onAction) callbacks.onAction(a.id);
          },
        }, [
          a.name || a.id,
          h('span', { class: 'tiny', style: 'display:block;' }, [
            '消耗 ' + (a.cost != null ? a.cost : 0) + ' 行动点',
          ]),
        ])
      );
    }
    return grid;
  }

  function render(state, view) {
    if (!state) return;
    clearRoot();
    const balance = (config && config.balance) || {};
    const maxTurn = Number.isFinite(balance.turns) ? balance.turns : 40;
    const apMax = Number.isFinite(balance.actionPointsPerTurn)
      ? balance.actionPointsPerTurn
      : 4;
    const availability = (view && view.availability) || {};
    const player = state.player || {};
    const attrs = player.attributes || {};

    const statsGrid = h(
      'div',
      { class: 'grid grid--2' },
      ATTRIBUTE_META.map((m) => buildStat(m, Number(attrs[m.key]) || 0))
    );
    const tagPills = (player.tags || []).map((t) =>
      h('span', { class: 'pill pill--accent' }, [findTagName(t)])
    );

    const statsCard = h('div', { class: 'card stack' }, [
      h('div', { class: 'row row--between' }, [
        h('div', {}, [
          h('div', { class: 'section-title' }, [player.name || '无名']),
          h('p', { class: 'muted' }, [
            findCollegeName(player.collegeId) + ' · ' + (player.gender || ''),
          ]),
        ]),
        h('div', { class: 'row' }, tagPills),
      ]),
      statsGrid,
    ]);

    const actionsCard = h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['🎯 本周行动']),
      buildActions(state, availability),
    ]);

    const canAdvance = state.actionPoints === 0;
    const advanceBtn = h('button', {
      class:
        'btn btn--secondary btn--block btn--lg' +
        (canAdvance ? '' : ' is-disabled'),
      disabled: !canAdvance,
      onclick: () => {
        if (canAdvance && callbacks.onAdvance) callbacks.onAdvance();
      },
    }, ['⏭️ 推进回合（行动点用尽后可点）']);

    const recentLogs = Array.isArray(state.log) ? state.log.slice(-6).reverse() : [];
    const logCard = h('div', { class: 'card stack' }, [
      h('div', { class: 'section-title' }, ['📜 近期动态']),
      h(
        'div',
        { class: 'stack-2' },
        recentLogs.length
          ? recentLogs.map((t) => h('p', { class: 'tiny' }, ['· ' + t]))
          : [h('p', { class: 'tiny muted' }, ['暂无动态'])]
      ),
    ]);

    rootEl.appendChild(
      h('div', { class: 'screen stack-6' }, [
        buildTopbar(state, maxTurn, apMax),
        statsCard,
        actionsCard,
        advanceBtn,
        logCard,
      ])
    );
  }

  // ---------------- 弹窗：事件 ----------------
  function showEvent(ev) {
    if (!ev) return;
    const def = findEventById(ev.eventId) || {};
    const title = def.name || ev.eventId || '事件';
    const body = def.text || '';
    const options = Array.isArray(ev.options)
      ? ev.options
      : Array.isArray(def.options)
      ? def.options
      : [];
    const overlay = h('div', { class: 'modal-overlay' }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        h('h3', { class: 'modal__title' }, [title]),
        h('p', { class: 'modal__body' }, [body]),
        h('div', { class: 'modal__actions' }, options.map((o) =>
          h('button', {
            class: 'btn btn--primary btn--block',
            onclick: () => {
              if (callbacks.onResolveEvent) callbacks.onResolveEvent(o.id);
            },
          }, [o.label || o.id])
        )),
      ]),
    ]);
    overlayEl = overlay;
    rootEl.appendChild(overlay);
  }

  // ---------------- 弹窗：结局 ----------------
  function showEnding(e) {
    if (!e) return;
    const overlay = h('div', { class: 'modal-overlay' }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        h('div', {
          class: 'topbar__brand',
          style: 'font-size:14px;margin-bottom:8px;',
        }, ['🎓 毕业结局']),
        h('h3', { class: 'modal__title' }, [e.name || '结局']),
        h('p', { class: 'modal__body' }, [e.desc || '']),
        h('div', { class: 'modal__actions' }, [
          h('button', {
            class: 'btn btn--primary btn--block',
            onclick: () => {
              if (callbacks.onOpenMenu) callbacks.onOpenMenu();
            },
          }, ['🏠 返回主菜单']),
        ]),
      ]),
    ]);
    overlayEl = overlay;
    rootEl.appendChild(overlay);
  }

  // ---------------- 弹窗：图鉴 ----------------
  function showGallery(g) {
    const unlocked = g && Array.isArray(g.unlocked) ? g.unlocked : [];
    const list = (config && config.endings && config.endings.list) || [];
    const items = list.map((e) => {
      const got = unlocked.indexOf(e.id) >= 0;
      return h('div', { class: 'card' + (got ? '' : ' is-disabled') }, [
        h('div', { class: 'row row--between' }, [
          h('span', { class: 'section-title', style: 'font-size:16px;' }, [
            got ? e.name || e.id : '？？？',
          ]),
          got
            ? h('span', { class: 'pill pill--success' }, ['已解锁'])
            : h('span', { class: 'pill' }, ['未解锁']),
        ]),
        h('p', { class: 'muted' }, [
          got ? e.desc || '' : '未知结局，继续游玩以解锁。',
        ]),
      ]);
    });
    const overlay = h('div', {
      class: 'modal-overlay',
      onclick: (ev) => {
        if (ev.target === overlay) closeOverlay();
      },
    }, [
      h('div', {
        class: 'modal',
        role: 'dialog',
        'aria-modal': 'true',
        style: 'max-width:640px;',
      }, [
        h('h3', { class: 'modal__title' }, ['🏆 结局图鉴']),
        h('p', { class: 'modal__body' }, [
          '已解锁 ' + unlocked.length + ' / ' + list.length + ' 个结局',
        ]),
        h('div', { class: 'stack' }, items),
        h('div', { class: 'modal__actions' }, [
          h('button', {
            class: 'btn btn--secondary btn--block',
            onclick: () => closeOverlay(),
          }, ['关闭']),
        ]),
      ]),
    ]);
    overlayEl = overlay;
    rootEl.appendChild(overlay);
  }

  // ---------------- 弹窗：设置（基础实现） ----------------
  function showSettings(settings, onSave) {
    const s = settings || {
      seedDisplay: false,
      reduceMotion: false,
      lastSaveAt: 0,
    };
    let reduceMotion = !!s.reduceMotion;
    const motionBtn = h('button', {
      class: 'btn ' + (reduceMotion ? 'btn--primary' : 'btn--secondary'),
      onclick: () => {
        reduceMotion = !reduceMotion;
        motionBtn.className =
          'btn ' + (reduceMotion ? 'btn--primary' : 'btn--secondary');
        motionBtn.textContent = reduceMotion ? '已开启' : '已关闭';
      },
    }, [reduceMotion ? '已开启' : '已关闭']);
    const overlay = h('div', {
      class: 'modal-overlay',
      onclick: (ev) => {
        if (ev.target === overlay) closeOverlay();
      },
    }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        h('h3', { class: 'modal__title' }, ['⚙️ 设置']),
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label' }, ['减弱动画 (reduceMotion)']),
          h('div', { class: 'row' }, [motionBtn]),
        ]),
        h('div', { class: 'modal__actions' }, [
          h('button', {
            class: 'btn btn--primary btn--block',
            onclick: () => {
              closeOverlay();
              if (onSave) onSave({ reduceMotion });
            },
          }, ['保存']),
          h('button', {
            class: 'btn btn--secondary btn--block',
            onclick: () => closeOverlay(),
          }, ['取消']),
        ]),
      ]),
    ]);
    overlayEl = overlay;
    rootEl.appendChild(overlay);
  }

  // ---------------- 提示条：错误 ----------------
  function showError(msg) {
    if (!msg) return;
    const toast = h('div', { class: 'toast toast--danger' }, [String(msg)]);
    rootEl.appendChild(toast);
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 2200);
    }
  }

  return {
    mount,
    render,
    showEvent,
    showEnding,
    showError,
    showGallery,
    showSettings,
    startCreation,
  };
}
