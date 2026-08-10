import { collection, doc } from "firebase/firestore";
import { competitionId, db } from "./config.js";

export const competitionRef = () => doc(db, "competitions", competitionId);
export const levelRef = (levelId) => doc(competitionRef(), "levels", levelId);
export const teamsCol = (levelId) => collection(levelRef(levelId), "teams");
export const teamRef = (levelId, teamId) => doc(teamsCol(levelId), teamId);
export const mainScoresCol = (levelId) => collection(levelRef(levelId), "mainScores");
export const mainScoreRef = (levelId, teamId) => doc(mainScoresCol(levelId), teamId);
export const pkSessionsCol = (levelId) => collection(levelRef(levelId), "pkSessions");
export const pkAttemptsCol = (levelId) => collection(levelRef(levelId), "pkAttempts");
export const auditLogsCol = (levelId) => collection(levelRef(levelId), "auditLogs");
export const settingsRef = () => doc(competitionRef(), "settings", "main");
export const usersCol = () => collection(competitionRef(), "users");
