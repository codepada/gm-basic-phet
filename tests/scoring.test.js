import { describe, expect, it } from "vitest";
import { TARGETS, PK_POLICY } from "../src/core/constants.js";
import { mainScore, missionScore, pkScore, shotScore, smoothnessScore } from "../src/core/scoring.js";
import { pkNeededForMain, splitPkGroupAfterRound } from "../src/core/pk.js";

describe("main scoring", () => {
  it("calculates smoothness with hand and dropped part penalties", () => {
    expect(smoothnessScore(0, 0)).toBe(20);
    expect(smoothnessScore(2, 3)).toBe(10);
    expect(smoothnessScore(20, 20)).toBe(0);
  });

  it("zeros a shot when distance is under 90 cm", () => {
    expect(missionScore({ distancePassed: false, target: TARGETS.point3, results: ["score", "score"] })).toBe(0);
  });

  it("does not award points for unselected defaults", () => {
    const score = shotScore(
      {
        target: TARGETS.launcher,
        distancePassed: null,
        handCount: null,
        droppedPartsCount: null,
        autoLaunch: null,
        touches: [null, null],
        results: [null, null],
      },
      0,
    );
    expect(score.total).toBe(0);
    expect(score.smoothness).toBe(0);
  });

  it("allows confirmed zero smoothness counts to score 20", () => {
    const score = shotScore(
      {
        target: TARGETS.launcher,
        distancePassed: true,
        handCount: 0,
        droppedPartsCount: 0,
        autoLaunch: false,
        touches: [true, true],
        results: [null, null],
      },
      0,
    );
    expect(score.smoothness).toBe(20);
  });

  it("ignores touched balls and scores launcher targets", () => {
    expect(
      missionScore({
        distancePassed: true,
        target: TARGETS.launcher,
        touches: [false, true],
        results: ["A", "A"],
      }),
    ).toBe(5);
  });

  it("calculates full main total with three stored shots", () => {
    const score = mainScore({
      deviceCount: 5,
      shots: [
        { target: TARGETS.launcher, distancePassed: true, handCount: 0, droppedPartsCount: 0, autoLaunch: true, touches: [false, false], results: ["A", "B"] },
        { target: TARGETS.point3, distancePassed: true, autoLaunch: true, touches: [false, false], results: ["score", "score"] },
        { target: TARGETS.launcher, distancePassed: true, autoLaunch: false, touches: [false, false], results: ["C", "C"] },
      ],
    });
    expect(score.total).toBe(5 + 20 + 2 + 9 + 2 + 20 + 0 + 6);
  });

  it("calculates PK without device or smoothness", () => {
    expect(pkScore({ target: TARGETS.point3, distancePassed: true, autoLaunch: true, touches: [false, true], results: ["score", "score"] })).toBe(12);
  });
});

describe("PK policy", () => {
  const teams = [
    { id: "a", name: "A", mainTotal: 100 },
    { id: "b", name: "B", mainTotal: 100 },
    { id: "c", name: "C", mainTotal: 90 },
    { id: "d", name: "D", mainTotal: 80 },
    { id: "e", name: "E", mainTotal: 70 },
    { id: "f", name: "F", mainTotal: 60 },
    { id: "g", name: "G", mainTotal: 60 },
  ];

  it("requires PK for podium ties and cutoff crossing ties", () => {
    const needs = pkNeededForMain(teams, 6, PK_POLICY.podiumCutoff);
    expect(needs.map((need) => need.teamIds)).toEqual([
      ["a", "b"],
      ["f", "g"],
    ]);
  });

  it("requires all ties inside exact ranking cutoff", () => {
    const needs = pkNeededForMain(teams, 7, PK_POLICY.exactRanking);
    expect(needs.map((need) => need.teamIds)).toEqual([
      ["a", "b"],
      ["f", "g"],
    ]);
  });

  it("can track a tie that continues until PK round 5", () => {
    let activeTeamIds = ["a", "b", "c"];
    const attempts = [];
    const badges = {};
    const rounds = [
      { round: 1, scores: { a: 10, b: 10, c: 6 } },
      { round: 2, scores: { a: 8, b: 8 } },
      { round: 3, scores: { a: 7, b: 7 } },
      { round: 4, scores: { a: 5, b: 5 } },
      { round: 5, scores: { a: 9, b: 3 } },
    ];

    rounds.forEach(({ round, scores }) => {
      activeTeamIds.forEach((teamId) => {
        attempts.push({ sessionId: "pk-main-1", pkRound: round, teamId, score: scores[teamId] });
        badges[teamId] = [...(badges[teamId] || []), round];
      });
      const result = splitPkGroupAfterRound({ id: "pk-main-1", groupTeamIds: activeTeamIds, pkRound: round }, attempts);
      activeTeamIds = result.tiedGroups[0]?.teamIds || [];
    });

    expect(badges).toEqual({
      a: [1, 2, 3, 4, 5],
      b: [1, 2, 3, 4, 5],
      c: [1],
    });
    expect(activeTeamIds).toEqual([]);
  });
});
