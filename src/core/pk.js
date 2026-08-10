import { PK_POLICY } from "./constants.js";

export function sortByMainScore(teams) {
  return [...teams].sort((a, b) => (b.mainTotal ?? 0) - (a.mainTotal ?? 0) || a.name.localeCompare(b.name, "th"));
}

export function rankGroupsByScore(entries, scoreKey = "mainTotal") {
  const sorted = [...entries].sort((a, b) => (b[scoreKey] ?? 0) - (a[scoreKey] ?? 0) || a.name.localeCompare(b.name, "th"));
  const groups = [];
  let cursor = 1;
  for (let index = 0; index < sorted.length; ) {
    const score = sorted[index][scoreKey] ?? 0;
    const tied = sorted.filter((entry) => (entry[scoreKey] ?? 0) === score);
    const already = groups.reduce((sum, group) => sum + group.teams.length, 0);
    groups.push({
      startPlace: already + 1,
      endPlace: already + tied.length,
      score,
      teams: tied,
    });
    index += tied.length;
    cursor += tied.length;
  }
  void cursor;
  return groups;
}

export function pkNeededForMain(teams, awardCutoff = 3, policy = PK_POLICY.podiumCutoff) {
  const groups = rankGroupsByScore(teams, "mainTotal");
  return groups
    .filter((group) => group.teams.length > 1)
    .filter((group) => {
      if (policy === PK_POLICY.exactRanking) {
        return group.startPlace <= awardCutoff;
      }

      const touchesPodium = group.startPlace <= 3 && group.endPlace >= 1;
      const crossesCutoff = group.startPlace <= awardCutoff && group.endPlace > awardCutoff;
      return touchesPodium || crossesCutoff;
    })
    .map((group) => ({
      placeStart: group.startPlace,
      placeEnd: Math.min(group.endPlace, awardCutoff),
      boundary: group.startPlace <= awardCutoff && group.endPlace > awardCutoff ? awardCutoff : null,
      teamIds: group.teams.map((team) => team.id),
      score: group.score,
    }));
}

export function pkRoundComplete(session, attempts) {
  const completed = new Set(attempts.filter((attempt) => attempt.sessionId === session.id && attempt.pkRound === session.pkRound).map((attempt) => attempt.teamId));
  return session.groupTeamIds.every((teamId) => completed.has(teamId));
}

export function splitPkGroupAfterRound(session, attempts) {
  const roundAttempts = attempts.filter((attempt) => attempt.sessionId === session.id && attempt.pkRound === session.pkRound);
  if (roundAttempts.length < session.groupTeamIds.length) {
    return { complete: false, winners: [], tiedGroups: [] };
  }

  const sorted = [...roundAttempts].sort((a, b) => b.score - a.score);
  const groups = [];
  for (const attempt of sorted) {
    const existing = groups.find((group) => group.score === attempt.score);
    if (existing) existing.teamIds.push(attempt.teamId);
    else groups.push({ score: attempt.score, teamIds: [attempt.teamId] });
  }

  return {
    complete: true,
    winners: groups.filter((group) => group.teamIds.length === 1),
    tiedGroups: groups.filter((group) => group.teamIds.length > 1),
  };
}
