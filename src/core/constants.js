export const LEVELS = [
  { id: "sci01", label: "ประถมศึกษา" },
  { id: "sci02", label: "มัธยมศึกษาตอนต้น" },
  { id: "sci03", label: "มัธยมศึกษาตอนปลาย" },
];

export const LEVEL_LABELS = Object.fromEntries(LEVELS.map((level) => [level.id, level.label]));

export const ROLES = {
  admin: "admin",
  sci01: "sci01",
  sci02: "sci02",
  sci03: "sci03",
};

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
