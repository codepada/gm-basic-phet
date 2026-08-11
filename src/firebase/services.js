import {
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { mainScore, pkScore } from "../core/scoring.js";
import { pkAttemptsCol, pkSessionsCol, teamRef, teamsCol, mainScoresCol, mainScoreRef, auditLogsCol, settingsRef, competitionRef, usersCol } from "./paths.js";
import { db, storage } from "./config.js";

export function listenTeams(levelId, callback, onError) {
  return onSnapshot(
    query(teamsCol(levelId), orderBy("order", "asc")),
    (snapshot) => {
      callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    onError,
  );
}

export function listenMainScores(levelId, callback, onError) {
  return onSnapshot(
    query(mainScoresCol(levelId)),
    (snapshot) => {
      callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    onError,
  );
}

export async function importTeams(levelId, names, user) {
  const cleanNames = names.map((name) => name.trim()).filter(Boolean);
  const duplicates = cleanNames.filter((name, index) => cleanNames.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`ชื่อทีมซ้ำ: ${[...new Set(duplicates)].join(", ")}`);

  const existing = await getDocs(teamsCol(levelId));
  const existingNames = new Set(existing.docs.map((team) => team.data().name));
  const duplicateExisting = cleanNames.filter((name) => existingNames.has(name));
  if (duplicateExisting.length) throw new Error(`ชื่อทีมมีอยู่แล้ว: ${duplicateExisting.join(", ")}`);

  const batch = writeBatch(db);
  cleanNames.forEach((name, index) => {
    const ref = doc(teamsCol(levelId));
    batch.set(ref, {
      name,
      order: existing.size + index + 1,
      status: "pending",
      createdAt: serverTimestamp(),
      createdBy: user?.uid || "admin",
    });
  });
  await batch.commit();
}

export async function upsertTeam(levelId, teamId, data, user, reason = "") {
  const ref = teamId ? teamRef(levelId, teamId) : doc(teamsCol(levelId));
  const before = teamId ? (await getDoc(ref)).data() : null;
  await setDoc(ref, { ...data, updatedAt: serverTimestamp(), updatedBy: user?.uid || "admin" }, { merge: true });
  await addAudit(levelId, user, {
    teamId: ref.id,
    action: teamId ? "team.update" : "team.create",
    before,
    after: data,
    reason,
  });
}

export async function deleteTeam(levelId, teamId, user, reason = "") {
  const ref = teamRef(levelId, teamId);
  const before = (await getDoc(ref)).data();
  await deleteDoc(ref);
  await addAudit(levelId, user, { teamId, action: "team.delete", before, after: null, reason });
}

export async function lockTeam(levelId, teamId, user) {
  const ref = teamRef(levelId, teamId);
  await runTransaction(ref.firestore, async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();
    if (data?.lock?.uid && data.lock.uid !== user.uid) {
      throw new Error(`ทีมนี้กำลังถูกตัดสินโดย ${data.lock.role || data.lock.uid}`);
    }
    transaction.update(ref, {
      lock: {
        uid: user.uid,
        role: user.role,
        at: serverTimestamp(),
      },
    });
  });
}

export async function unlockTeam(levelId, teamId, user, reason = "admin unlock") {
  const ref = teamRef(levelId, teamId);
  const before = (await getDoc(ref)).data();
  await updateDoc(ref, { lock: null });
  await addAudit(levelId, user, { teamId, action: "team.unlock", before, after: { lock: null }, reason });
}

export async function submitMainScore(levelId, teamId, scoreDraft, user, reason = "") {
  const ref = mainScoreRef(levelId, teamId);
  const teamDocRef = teamRef(levelId, teamId);
  await runTransaction(ref.firestore, async (transaction) => {
    const existing = await transaction.get(ref);
    const before = existing.exists() ? existing.data() : null;

    const total = mainScore(scoreDraft);
    const payload = {
      ...scoreDraft,
      teamId,
      levelId,
      breakdown: total,
      total: total.total,
      completedShots: 3,
      updatedAt: serverTimestamp(),
      updatedBy: user?.uid || "local-test",
    };
    transaction.set(ref, payload, { merge: true });
    transaction.set(teamDocRef, {
      name: scoreDraft.teamName || teamId,
      order: scoreDraft.teamOrder || 999,
      status: "main-complete",
      mainTotal: total.total,
      lock: null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(doc(auditLogsCol(levelId)), {
      teamId,
      levelId,
      judge: user?.uid || "local-test",
      action: before ? "mainScore.update" : "mainScore.create",
      before,
      after: payload,
      reason,
      createdAt: serverTimestamp(),
    });
  });
}

export async function createPkSession(levelId, session, user) {
  const sessionRef = doc(pkSessionsCol(levelId));
  await runTransaction(sessionRef.firestore, async (transaction) => {
    transaction.set(sessionRef, {
      ...session,
      levelId,
      pkRound: session.pkRound || 1,
      pendingTeamIds: session.groupTeamIds,
      completedTeamIds: [],
      status: "active",
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  });
}

export async function submitPkAttempt(levelId, session, attemptDraft, user) {
  const attemptCollection = pkAttemptsCol(levelId);
  await runTransaction(attemptCollection.firestore, async (transaction) => {
    const attemptRef = doc(attemptCollection, `${session.id}-r${session.pkRound}-${attemptDraft.teamId}`);
    const existing = await transaction.get(attemptRef);
    if (existing.exists()) throw new Error("ทีมนี้ยิง PK รอบนี้แล้ว");

    const score = pkScore(attemptDraft);
    transaction.set(attemptRef, {
      ...attemptDraft,
      levelId,
      sessionId: session.id,
      pkRound: session.pkRound,
      score,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    transaction.update(doc(pkSessionsCol(levelId), session.id), {
      pendingTeamIds: session.pendingTeamIds.filter((teamId) => teamId !== attemptDraft.teamId),
      completedTeamIds: [...new Set([...session.completedTeamIds, attemptDraft.teamId])],
      updatedAt: serverTimestamp(),
    });
  });
}

export async function addAudit(levelId, user, payload) {
  await addDoc(auditLogsCol(levelId), {
    ...payload,
    levelId,
    judge: user?.uid || "system",
    judgeRole: user?.role || "unknown",
    createdAt: serverTimestamp(),
  });
}

export async function saveSettings(settings, user) {
  await setDoc(settingsRef(), { ...settings, updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: true });
}

export async function backupNow(user) {
  const levels = {};
  for (const levelId of ["sci01", "sci02", "sci03"]) {
    levels[levelId] = {};
    for (const [key, collectionFactory] of [
      ["teams", teamsCol],
      ["mainScores", mainScoresCol],
      ["pkSessions", pkSessionsCol],
      ["pkAttempts", pkAttemptsCol],
      ["auditLogs", auditLogsCol],
    ]) {
      const snapshot = await getDocs(collectionFactory(levelId));
      levels[levelId][key] = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    }
  }
  const users = (await getDocs(usersCol())).docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const payload = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: user.uid,
    competition: (await getDoc(competitionRef())).data() || {},
    levels,
    users,
  };
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replaceAll(":", "-");
  const fileRef = ref(storage, `backups/${date}/competition-backup-${time}.json`);
  await uploadString(fileRef, JSON.stringify(payload, null, 2), "raw", { contentType: "application/json" });
  return getDownloadURL(fileRef);
}
