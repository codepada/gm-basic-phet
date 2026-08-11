export const LEVELS = [
  { id: "el", label: "ประถมศึกษา", shortLabel: "ประถม" },
  { id: "jh", label: "มัธยมศึกษาตอนต้น", shortLabel: "ม.ต้น" },
  { id: "sh", label: "มัธยมศึกษาตอนปลาย", shortLabel: "ม.ปลาย" },
];

export const LEVEL_LABELS = Object.fromEntries(LEVELS.map((level) => [level.id, level.label]));
export const LEVEL_SHORT_LABELS = Object.fromEntries(LEVELS.map((level) => [level.id, level.shortLabel]));

export const ADMIN_ID = "admin";
export const AUTH_EMAIL_DOMAIN = "gm-basic-phet.local";

export const JUDGE_IDS_BY_LEVEL = {
  el: Array.from({ length: 10 }, (_, index) => `el${String(index + 1).padStart(2, "0")}`),
  jh: Array.from({ length: 10 }, (_, index) => `jh${String(index + 1).padStart(2, "0")}`),
  sh: Array.from({ length: 10 }, (_, index) => `sh${String(index + 1).padStart(2, "0")}`),
};

export const JUDGE_ACCOUNTS = Object.entries(JUDGE_IDS_BY_LEVEL).flatMap(([levelId, ids]) => ids.map((id) => ({ id, levelId })));
export const JUDGE_LEVEL_BY_ID = Object.fromEntries(JUDGE_ACCOUNTS.map((account) => [account.id, account.levelId]));
export const LOGIN_IDS = [ADMIN_ID, ...JUDGE_ACCOUNTS.map((account) => account.id)];

export const PK_POLICY = {
  podiumCutoff: "podiumCutoff",
  exactRanking: "exactRanking",
};

export const TARGETS = {
  launcher: "launcher",
  point3: "point3",
};

export const MAIN_SHOT_COUNT = 3;
export const BALL_COUNT = 2;
