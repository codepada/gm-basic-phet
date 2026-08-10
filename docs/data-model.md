# Firestore Data Model

## teams

`competitions/{competitionId}/levels/{levelId}/teams/{teamId}`

- name
- order
- status: pending | main-complete | pk-active | final
- mainTotal
- lock: { uid, role, at } | null
- createdAt / createdBy
- updatedAt / updatedBy

## mainScores

Document id equals team id. Store all 3 shots, never total only.

- teamId
- levelId
- deviceCount
- shots[0..2]
- breakdown
- total
- completedShots = 3
- updatedAt / updatedBy

## pkSessions

- levelId
- pkRound
- placeStart / placeEnd / boundary
- groupTeamIds
- pendingTeamIds
- completedTeamIds
- status
- result
- createdAt / createdBy

## pkAttempts

Append-only.

- levelId
- sessionId
- teamId
- pkRound
- target
- distancePassed
- autoLaunch
- touches[2]
- results[2]
- score
- createdAt / createdBy

## auditLogs

Append-only.

- createdAt
- judge
- judgeRole
- teamId
- levelId
- action
- before
- after
- reason
