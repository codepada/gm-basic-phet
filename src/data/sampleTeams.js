import { LEVELS } from "../core/constants.js";

export const sampleTeams = Object.fromEntries(
  LEVELS.map((level) => [
    level.id,
    Array.from({ length: 20 }, (_, index) => `GM ${level.id.toUpperCase()} Team ${String(index + 1).padStart(2, "0")}`),
  ]),
);
