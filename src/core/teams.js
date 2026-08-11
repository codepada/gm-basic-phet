export function nextUnscoredTeam(teams, scores, currentTeamId) {
  if (!teams?.length) return null;

  const currentIndex = teams.findIndex((team) => team.id === currentTeamId);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;
  const searchOrder = [...teams.slice(startIndex + 1), ...teams.slice(0, Math.max(startIndex, 0))];
  return searchOrder.find((team) => !scores?.[team.id]) ?? null;
}
