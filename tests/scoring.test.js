import { describe, expect, it } from "vitest";
import { TARGETS, PK_POLICY } from "../src/core/constants.js";
import { mainScore, missionScore, pkScore, shotScore, smoothnessScore } from "../src/core/scoring.js";
import { pkNeededForMain } from "../src/core/pk.js";

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
});
