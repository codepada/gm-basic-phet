export const LEVELS = [
  { id: "el", label: "ประถมศึกษา" },
  { id: "jh", label: "มัธยมศึกษาตอนต้น" },
  { id: "sh", label: "มัธยมศึกษาตอนปลาย" },
];

export const LEVEL_LABELS = Object.fromEntries(LEVELS.map((level) => [level.id, level.label]));

export const ADMIN_ID = "admin";
export const ADMIN_PASSWORD = "wgm2026";
export const JUDGE_PASSWORD = "1234";

export const JUDGE_IDS_BY_LEVEL = {
  el: ["el01", "el02", "el03"],
  jh: ["jh01", "jh02", "jh03", "jh04"],
  sh: ["sh01", "sh02", "sh03", "sh04"],
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
