import { BALL_COUNT, TARGETS } from "./constants.js";

export function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function smoothnessScore(handCount = 0, droppedPartsCount = 0) {
  return Math.max(0, 20 - 2 * (clampInteger(handCount, 0, 99) + clampInteger(droppedPartsCount, 0, 99)));
}

export function smoothnessReady(shot) {
  return Number.isInteger(shot?.handCount) && Number.isInteger(shot?.droppedPartsCount);
}

export function autoScore(autoLaunch) {
  return autoLaunch ? 2 : 0;
}

export function ballMissionPoints(target, result) {
  if (target === TARGETS.point3) {
    return result === "score" ? 10 : 0;
  }

  if (target === TARGETS.launcher) {
    if (result === "A") return 5;
    if (result === "B") return 4;
    if (result === "C") return 3;
  }

  return 0;
}

export function eligibleBallCount(touches = []) {
  return Array.from({ length: BALL_COUNT }, (_, index) => touches[index] !== true).filter(Boolean).length;
}

export function missionScore(shot) {
  if (shot?.distancePassed !== true) return 0;

  const touches = shot.touches || [];
  const results = shot.results || [];
  let total = 0;
  for (let index = 0; index < BALL_COUNT; index += 1) {
    if (touches[index]) continue;
    total += ballMissionPoints(shot.target, results[index]);
  }
  return total;
}

export function shotScore(shot, shotIndex) {
  if (shot?.distancePassed !== true) {
    return {
      auto: 0,
      smoothness: shotIndex === 0 ? (smoothnessReady(shot) ? smoothnessScore(shot.handCount, shot.droppedPartsCount) : 0) : null,
      mission: 0,
      total: 0,
    };
  }

  const smoothness = shotIndex === 0 && smoothnessReady(shot) ? smoothnessScore(shot.handCount, shot.droppedPartsCount) : null;
  const auto = autoScore(shot.autoLaunch);
  const mission = missionScore(shot);
  return {
    auto,
    smoothness,
    mission,
    total: auto + mission + (smoothness ?? 0),
  };
}

export function mainScore(score) {
  const device = clampInteger(score?.deviceCount ?? 0, 0, 5);
  const shots = score?.shots || [];
  const shotBreakdown = [0, 1, 2].map((index) => shotScore(shots[index], index));
  return {
    device,
    shots: shotBreakdown,
    smoothness: shotBreakdown[0].smoothness ?? 0,
    autoTotal: shotBreakdown.reduce((sum, shot) => sum + shot.auto, 0),
    missionTotal: shotBreakdown.reduce((sum, shot) => sum + shot.mission, 0),
    total: device + shotBreakdown.reduce((sum, shot) => sum + shot.total, 0),
  };
}

export function pkScore(attempt) {
  if (!attempt?.distancePassed) return 0;
  return autoScore(attempt.autoLaunch) + missionScore(attempt);
}

export function assertValidResults(shot) {
  const allowed = eligibleBallCount(shot.touches || []);
  const nonEmptyResults = (shot.results || []).filter(Boolean).length;
  if (nonEmptyResults > allowed) {
    throw new Error("จำนวนลูกที่ได้คะแนนมากกว่าจำนวนลูกที่ยังมีสิทธิ์");
  }
}
