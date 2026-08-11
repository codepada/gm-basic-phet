import { describe, expect, it } from "vitest";
import { nextUnscoredTeam } from "../src/core/teams.js";

describe("team navigation", () => {
  const teams = [
    { id: "team-1", name: "Team 1" },
    { id: "team-2", name: "Team 2" },
    { id: "team-3", name: "Team 3" },
  ];

  it("moves to the next unscored team after saving", () => {
    expect(nextUnscoredTeam(teams, { "team-1": {} }, "team-1")).toEqual(teams[1]);
  });

  it("wraps to an earlier unscored team when saving the last team", () => {
    expect(nextUnscoredTeam(teams, { "team-2": {}, "team-3": {} }, "team-3")).toEqual(teams[0]);
  });

  it("returns null when every team is scored", () => {
    expect(nextUnscoredTeam(teams, { "team-1": {}, "team-2": {}, "team-3": {} }, "team-2")).toBeNull();
  });
});
