/**
 * 学业模块（被 engine 调用）。
 */

const DEFAULT_EXAM = {
  base: 60,
  knowledgeWeight: 1,
  studyBonusPerAction: 1,
  difficultyBase: 10,
  passLine: 60,
};

function getExamConfig(config) {
  const balance = (config && config.balance) || {};
  if (balance.exam && typeof balance.exam === 'object') {
    return { ...DEFAULT_EXAM, ...balance.exam };
  }
  return { ...DEFAULT_EXAM };
}

/**
 * 每学期考试，写 academics（semesterScores / failedCourses）。
 * 公式：score = base + knowledgeWeight*knowledge + studyBonusPerAction*studyActions - difficulty
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ ok: boolean, score: number, passed: boolean }}
 */
export function takeExam(state, config, rng) {
  const exam = getExamConfig(config);
  const knowledge = Number(state.player.attributes.knowledge) || 0;
  const studyActions = Number(state.academics.studyActions) || 0;
  const difficulty = (exam.difficulty !== undefined)
    ? Number(exam.difficulty)
    : Number(exam.difficultyBase);
  let score = exam.base
    + exam.knowledgeWeight * knowledge
    + exam.studyBonusPerAction * studyActions
    - difficulty;
  score = Math.max(0, Math.min(100, score));
  const passed = score >= exam.passLine;
  if (!passed) state.academics.failedCourses += 1;
  return { ok: true, score, passed };
}

/**
 * 挂科达到阈值（>=3）置 warning=true，返回是否触发。
 * 阈值取自 balance.warningFailedCourses；本函数签名不含 config，使用常量 3。
 * @param {object} state
 * @returns {boolean}
 */
export function checkWarning(state) {
  const threshold = 3;
  if (state.academics.failedCourses >= threshold) {
    state.academics.warning = true;
    return true;
  }
  return false;
}
