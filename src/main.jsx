import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  ADMIN_ID,
  AUTH_EMAIL_DOMAIN,
  JUDGE_ACCOUNTS,
  JUDGE_IDS_BY_LEVEL,
  JUDGE_LEVEL_BY_ID,
  LEVELS,
  LEVEL_LABELS,
  LOGIN_IDS,
  PK_POLICY,
  TARGETS,
} from "./core/constants.js";
import { mainScore, missionScore, smoothnessReady, smoothnessScore } from "./core/scoring.js";
import { pkNeededForMain } from "./core/pk.js";
import { nextUnscoredTeam } from "./core/teams.js";
import { sampleTeams } from "./data/sampleTeams.js";
import { auth, isFirebaseConfigured } from "./firebase/config.js";
import { listenMainScores, listenSettings, listenTeams, resetLevelMainScores, saveSettings, saveTeamSetup, submitMainScore } from "./firebase/services.js";
import "./styles/app.css";

const initialTeams = Object.fromEntries(
  LEVELS.map((level) => [
    level.id,
    sampleTeams[level.id].map((name, index) => ({
      id: `${level.id}-${index + 1}`,
      name,
      order: index + 1,
      status: "pending",
      mainTotal: null,
    })),
  ]),
);

const STORAGE_KEYS = {
  teams: "gm-basic-phet.teamsByLevel",
  scores: "gm-basic-phet.scores",
  auditLogs: "gm-basic-phet.auditLogs",
  session: "gm-basic-phet.session",
  settings: "gm-basic-phet.settings",
};

function readStoredValue(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function defaultSettings() {
  return {
    judgeAssignments: Object.fromEntries(JUDGE_ACCOUNTS.map((account) => [account.id, { enabled: true, judgeName: "", from: 1, to: 999, pkTeamOrder: "" }])),
    pkAssignments: Object.fromEntries(JUDGE_ACCOUNTS.map((account) => [account.id, []])),
    pkConfigByLevel: Object.fromEntries(LEVELS.map((level) => [level.id, { awardCutoff: 6, pkPolicy: PK_POLICY.podiumCutoff }])),
    pkRoundsByLevel: Object.fromEntries(LEVELS.map((level) => [level.id, {}])),
  };
}

const blankShot = (withSmoothness = false) => ({
  target: null,
  distancePassed: null,
  handCount: withSmoothness ? 0 : undefined,
  droppedPartsCount: withSmoothness ? 0 : undefined,
  autoLaunch: null,
  touches: [null, null],
  results: [null, null],
});

function fullTeamName(team) {
  if (team.school && team.teamName) return `${team.school} - ${team.teamName}`;
  return team.name;
}

function teamWithinAssignment(team, assignment) {
  if (!assignment) return true;
  if (assignment.enabled === false) return false;
  const from = Number(assignment.from) || 1;
  const to = Number(assignment.to) || 999;
  return team.order >= from && team.order <= to;
}

function pkOrdersForJudge(settings, judgeId) {
  const assigned = settings.pkAssignments?.[judgeId];
  if (Array.isArray(assigned)) return assigned.map(Number).filter(Boolean);
  const legacyOrder = settings.judgeAssignments?.[judgeId]?.pkTeamOrder;
  return legacyOrder ? [Number(legacyOrder)] : [];
}

function sortTeamsForResults(teams) {
  return [...teams].sort((a, b) => {
    const aScored = Number.isFinite(a.mainTotal);
    const bScored = Number.isFinite(b.mainTotal);
    if (aScored && bScored) return b.mainTotal - a.mainTotal || a.order - b.order;
    if (aScored) return -1;
    if (bScored) return 1;
    return a.order - b.order;
  });
}

function pkRoundLabels(roundsByTeam, teamId) {
  const rounds = roundsByTeam?.[teamId];
  if (!Array.isArray(rounds)) return [];
  return [...new Set(rounds.map(Number).filter(Boolean))].sort((a, b) => a - b).map((round) => `PK${round}`);
}

function loginEmailForId(id) {
  return `${id.toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

function loginIdFromEmail(email) {
  return email?.toLowerCase().endsWith(`@${AUTH_EMAIL_DOMAIN}`) ? email.split("@")[0] : "";
}

function authPasswordForLogin(id, password) {
  if (id === ADMIN_ID) return password;
  return password === "1234" ? "123456" : password;
}

function App() {
  const [session, setSession] = useState(() => {
    const stored = readStoredValue(STORAGE_KEYS.session, null);
    return stored?.role && LOGIN_IDS.includes(stored.role) ? stored : null;
  });
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [role, setRole] = useState(session?.role || "");
  const [levelId, setLevelId] = useState(session?.role && session.role !== ADMIN_ID ? JUDGE_LEVEL_BY_ID[session.role] || "el" : "el");
  const [teamsByLevel, setTeamsByLevel] = useState(() => readStoredValue(STORAGE_KEYS.teams, initialTeams));
  const [scores, setScores] = useState(() => readStoredValue(STORAGE_KEYS.scores, {}));
  const [settings, setSettings] = useState(() => ({ ...defaultSettings(), ...readStoredValue(STORAGE_KEYS.settings, {}) }));
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [awardCutoff, setAwardCutoff] = useState(6);
  const [pkPolicy, setPkPolicy] = useState(PK_POLICY.podiumCutoff);
  const [auditLogs, setAuditLogs] = useState(() => readStoredValue(STORAGE_KEYS.auditLogs, []));
  const [syncStatus, setSyncStatus] = useState(isFirebaseConfigured ? "เชื่อมฐานข้อมูลกลางแล้ว" : "ยังไม่เชื่อมฐานข้อมูลกลาง");
  const [syncError, setSyncError] = useState("");
  const [setupStatus, setSetupStatus] = useState("");

  const teams = teamsByLevel[levelId] || [];
  const enrichedTeams = teams.map((team) => ({
    ...team,
    mainTotal: scores[team.id]?.breakdown?.total ?? team.mainTotal,
    status: scores[team.id] ? "main-complete" : team.status,
  }));
  const visibleTeams = role === ADMIN_ID
    ? enrichedTeams
    : enrichedTeams.filter((team) => teamWithinAssignment(team, settings.judgeAssignments?.[role]));

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.teams, teamsByLevel);
  }, [teamsByLevel]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.scores, scores);
  }, [scores]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.auditLogs, auditLogs);
  }, [auditLogs]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    const pkConfig = settings.pkConfigByLevel?.[levelId];
    if (!pkConfig) return;
    setAwardCutoff(Number(pkConfig.awardCutoff) || 6);
    setPkPolicy(pkConfig.pkPolicy || PK_POLICY.podiumCutoff);
  }, [levelId, settings.pkConfigByLevel]);

  useEffect(() => {
    if (session) writeStoredValue(STORAGE_KEYS.session, session);
    else window.localStorage.removeItem(STORAGE_KEYS.session);
  }, [session]);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return undefined;
    return onAuthStateChanged(auth, (user) => {
      setAuthReady(true);
      if (!user) {
        setSession(null);
        setRole("");
        setSelectedTeam(null);
        setSaveResult(null);
        return;
      }
      const nextRole = loginIdFromEmail(user.email);
      if (!LOGIN_IDS.includes(nextRole)) return;
      setSession({ role: nextRole, uid: user.uid, email: user.email, at: new Date().toISOString() });
      setRole(nextRole);
      setLevelId(nextRole === ADMIN_ID ? "el" : JUDGE_LEVEL_BY_ID[nextRole] || "el");
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !session || !authReady) return undefined;
    const unsubscribe = listenSettings(
      (remoteSettings) => {
        setSettings((current) => ({ ...defaultSettings(), ...current, ...remoteSettings }));
      },
      (error) => {
        setSyncStatus("อ่านการมอบหมายจาก Firebase ไม่ได้");
        setSyncError(error.message);
      },
    );
    return unsubscribe;
  }, [authReady, session]);

  useEffect(() => {
    if (!isFirebaseConfigured || !session || !authReady) return undefined;
    setSyncStatus("เชื่อมฐานข้อมูลกลางแล้ว");
    setSyncError("");
    const unsubscribe = listenTeams(
      levelId,
      (remoteTeams) => {
        if (!remoteTeams.length) return;
        setTeamsByLevel((current) => {
          const baseTeams = current[levelId]?.length ? current[levelId] : initialTeams[levelId];
          const remoteById = Object.fromEntries(remoteTeams.map((team) => [team.id, team]));
          const merged = baseTeams.map((team) => ({ ...team, ...remoteById[team.id] }));
          const extraRemoteTeams = remoteTeams.filter((team) => !baseTeams.some((baseTeam) => baseTeam.id === team.id));
          return { ...current, [levelId]: [...merged, ...extraRemoteTeams].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)) };
        });
      },
      (error) => {
        setSyncStatus("อ่านทีมจาก Firebase ไม่ได้");
        setSyncError(error.message);
      },
    );
    return unsubscribe;
  }, [authReady, levelId, session]);

  useEffect(() => {
    if (!isFirebaseConfigured || !session || !authReady) return undefined;
    const unsubscribe = listenMainScores(
      levelId,
      (remoteScores) => {
        setScores((current) => {
          const next = Object.fromEntries(
            Object.entries(current).filter(([teamId, score]) => score?.levelId !== levelId && !teamId.startsWith(`${levelId}-`)),
          );
          remoteScores.forEach((score) => {
            next[score.teamId || score.id] = score;
          });
          return next;
        });
      },
      (error) => {
        setSyncStatus("อ่านคะแนนจาก Firebase ไม่ได้");
        setSyncError(error.message);
      },
    );
    return unsubscribe;
  }, [authReady, levelId, session]);

  const saveMainScore = async (team, draft, reason = "") => {
    const before = scores[team.id] || null;
    const breakdown = mainScore(draft);
    const after = {
      ...draft,
      teamName: fullTeamName(team),
      school: team.school || "",
      displayTeamName: team.teamName || team.name,
      teamOrder: team.order,
      teamId: team.id,
      levelId,
      breakdown,
      total: breakdown.total,
      completedShots: 3,
      updatedAt: new Date().toISOString(),
      updatedBy: role,
    };
    const nextScores = { ...scores, [team.id]: after };
    const currentTeams = role === ADMIN_ID
      ? teamsByLevel[levelId] || []
      : (teamsByLevel[levelId] || []).filter((team) => teamWithinAssignment(team, settings.judgeAssignments?.[role]));
    const nextTeam = nextUnscoredTeam(currentTeams, nextScores, team.id);

    if (isFirebaseConfigured) {
      setSyncStatus("กำลัง sync Firebase...");
      setSyncError("");
      try {
        await submitMainScore(levelId, team.id, after, { uid: role, role }, reason);
        setSyncStatus("sync Firebase สำเร็จ");
      } catch (error) {
        setSyncStatus("sync Firebase ไม่สำเร็จ");
        setSyncError(error.message);
        throw new Error(`บันทึก Firebase ไม่สำเร็จ: ${error.message}`);
      }
    }

    setScores(nextScores);
    setTeamsByLevel((current) => ({
      ...current,
      [levelId]: current[levelId].map((item) => (item.id === team.id ? { ...item, status: "main-complete", mainTotal: breakdown.total } : item)),
    }));
    setAuditLogs((current) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        judge: role,
        levelId,
        team: fullTeamName(team),
        action: before ? "mainScore.update" : "mainScore.create",
        before,
        after,
        reason,
      },
      ...current,
    ]);
    setSelectedTeam(null);
    setSaveResult({ savedTeam: { ...team, name: fullTeamName(team) }, nextTeam: nextTeam ? { ...nextTeam, name: fullTeamName(nextTeam) } : null, total: breakdown.total });
  };

  const saveTeamsFromAdmin = async (entries) => {
    const cleanEntries = entries.map((entry, index) => {
      if (typeof entry === "string") {
        const name = entry.trim();
        return { order: index + 1, school: "", teamName: name, name };
      }
      const school = entry.school?.trim() || "";
      const teamName = entry.teamName?.trim() || "";
      return {
        order: Number(entry.order) || index + 1,
        school,
        teamName,
        name: school && teamName ? `${school} - ${teamName}` : teamName || school,
      };
    });
    const filledEntries = cleanEntries.filter((entry) => entry.name);
    const duplicates = filledEntries
      .map((entry) => entry.name)
      .filter((name, index, names) => names.indexOf(name) !== index);
    if (filledEntries.length !== cleanEntries.length) throw new Error("ยังมีชื่อทีมหรือชื่อโรงเรียนว่าง");
    if (duplicates.length) throw new Error(`ชื่อทีมซ้ำ: ${[...new Set(duplicates)].join(", ")}`);

    const currentLevelTeams = teamsByLevel[levelId] || [];
    const currentIds = new Set(currentLevelTeams.map((team) => team.id));
    const nextTeams = filledEntries.map((entry, index) => {
      const id = `${levelId}-${index + 1}`;
      const score = scores[id];
      return {
        id,
        name: entry.name,
        school: entry.school,
        teamName: entry.teamName,
        order: entry.order || index + 1,
        status: score ? "main-complete" : "pending",
        mainTotal: score?.breakdown?.total ?? null,
      };
    });
    const nextIds = new Set(nextTeams.map((team) => team.id));

    setTeamsByLevel((current) => ({ ...current, [levelId]: nextTeams }));
    setScores((current) => {
      const next = { ...current };
      currentIds.forEach((teamId) => {
        if (!nextIds.has(teamId)) delete next[teamId];
      });
      return next;
    });
    setSetupStatus("บันทึกตั้งค่าทีมในหน้านี้แล้ว");

    if (isFirebaseConfigured) {
      setSyncStatus("กำลัง sync รายชื่อทีม...");
      setSyncError("");
      try {
        await saveTeamSetup(levelId, nextTeams, { uid: role || "admin", role: "admin" });
        setSyncStatus("sync รายชื่อทีมสำเร็จ");
        setSetupStatus("บันทึกและ sync รายชื่อทีมสำเร็จ");
      } catch (error) {
        setSyncStatus("บันทึกรายชื่อในเครื่องแล้ว แต่ sync Firebase ไม่สำเร็จ");
        setSyncError(error.message);
        throw error;
      }
    }
  };

  const resetScoresFromAdmin = async () => {
    const currentTeams = teamsByLevel[levelId] || [];
    const levelLabel = LEVEL_LABELS[levelId];
    if (!window.confirm(`ยืนยันรีเซ็ตคะแนน ${levelLabel} หรือไม่?\nคะแนนที่กรรมการบันทึกไว้ในระดับนี้จะถูกลบทั้งหมด เพื่อเริ่มทดสอบใหม่`)) return false;
    const confirmText = window.prompt(`ยืนยันครั้งที่ 2: พิมพ์ RESET เพื่อล้างคะแนน ${levelLabel}`);
    if (confirmText !== "RESET") return false;

    const teamIds = new Set(currentTeams.map((team) => team.id));
    setScores((current) => {
      const next = { ...current };
      teamIds.forEach((teamId) => {
        delete next[teamId];
      });
      return next;
    });
    setTeamsByLevel((current) => ({
      ...current,
      [levelId]: (current[levelId] || []).map((team) => ({ ...team, status: "pending", mainTotal: null, lock: null })),
    }));
    const clearedPkRoundsByLevel = {
      ...(settings.pkRoundsByLevel || {}),
      [levelId]: {},
    };
    setSettings((current) => ({
      ...current,
      pkRoundsByLevel: {
        ...(current.pkRoundsByLevel || {}),
        [levelId]: {},
      },
    }));
    setAuditLogs((current) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        judge: ADMIN_ID,
        levelId,
        team: levelLabel,
        action: "mainScores.reset",
      },
      ...current,
    ]);

    if (isFirebaseConfigured) {
      setSyncStatus("กำลังรีเซ็ตคะแนน Firebase...");
      setSyncError("");
      try {
        await resetLevelMainScores(levelId, { uid: ADMIN_ID, role: "admin" });
        await saveSettings({ pkRoundsByLevel: clearedPkRoundsByLevel }, { uid: ADMIN_ID });
        setSyncStatus("รีเซ็ตคะแนน Firebase สำเร็จ");
      } catch (error) {
        setSyncStatus("รีเซ็ตในเครื่องแล้ว แต่รีเซ็ต Firebase ไม่สำเร็จ");
        setSyncError(error.message);
        throw error;
      }
    }
    return true;
  };

  const handleLogin = async ({ id, password }) => {
    const cleanId = id.toLowerCase();
    if (!LOGIN_IDS.includes(cleanId)) throw new Error("ไม่พบ ID นี้");
    if (!isFirebaseConfigured || !auth) throw new Error("Firebase Auth ยังไม่พร้อม");
    const credential = await signInWithEmailAndPassword(auth, loginEmailForId(cleanId), authPasswordForLogin(cleanId, password));
    setSession({ role: cleanId, uid: credential.user.uid, email: credential.user.email, at: new Date().toISOString() });
    setRole(cleanId);
    setLevelId(cleanId === ADMIN_ID ? "el" : JUDGE_LEVEL_BY_ID[cleanId] || "el");
    setSelectedTeam(null);
    setSaveResult(null);
  };

  const handleLogout = async () => {
    if (auth) await signOut(auth);
    setSession(null);
    setRole("");
    setSelectedTeam(null);
    setSaveResult(null);
  };

  if (!authReady) {
    return <LoadingPage message="กำลังตรวจสอบการเข้าสู่ระบบ..." />;
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (saveResult) {
    return (
      <SaveCompletePage
        result={saveResult}
        levelId={levelId}
        onNext={() => {
          setSelectedTeam(saveResult.nextTeam);
          setSaveResult(null);
        }}
        onList={() => setSaveResult(null)}
      />
    );
  }

  if (selectedTeam) {
    return <ScoreWizard key={selectedTeam.id} levelId={levelId} team={selectedTeam} existing={scores[selectedTeam.id]} onCancel={() => setSelectedTeam(null)} onSave={saveMainScore} />;
  }

  const currentJudgeAssignment = role === ADMIN_ID ? null : settings.judgeAssignments?.[role];
  const judgeName = currentJudgeAssignment?.judgeName?.trim();

  return (
    <main className={`app-shell level-theme-${levelId}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">{role === ADMIN_ID ? "Green Mech Scoring" : `ID ${role.toUpperCase()}`}</p>
          <h1>{role === ADMIN_ID ? "Admin Dashboard" : judgeName || `Judge ${role.toUpperCase()}`}</h1>
        </div>
        <button className="ghost topbar-logout" onClick={handleLogout}>ออก</button>
      </header>
      {syncError ? <SyncBanner status={syncStatus} error={syncError} /> : null}

      {role === ADMIN_ID ? <LevelTabs levelId={levelId} setLevelId={setLevelId} /> : null}

      {role === ADMIN_ID ? (
        <AdminPage
          levelId={levelId}
          teams={enrichedTeams}
          scores={scores}
          auditLogs={auditLogs}
          settings={settings}
          isCloudReady={isFirebaseConfigured && !syncError}
          setupStatus={setupStatus}
          awardCutoff={awardCutoff}
          setAwardCutoff={setAwardCutoff}
          pkPolicy={pkPolicy}
          setPkPolicy={setPkPolicy}
          onSaveTeamSetup={saveTeamsFromAdmin}
          onResetScores={resetScoresFromAdmin}
          onSaveSettings={async (nextSettings) => {
            setSettings((current) => ({ ...current, ...nextSettings }));
            if (isFirebaseConfigured) await saveSettings(nextSettings, { uid: ADMIN_ID });
          }}
        />
      ) : (
        <JudgePage teams={visibleTeams} scores={scores} assignment={currentJudgeAssignment} pkOrders={pkOrdersForJudge(settings, role)} onScore={setSelectedTeam} />
      )}
    </main>
  );
}

function LoginPage({ onLogin }) {
  const [id, setId] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await onLogin({ id, password });
    } catch (loginError) {
      const message = loginError.code === "auth/invalid-credential" || loginError.code === "auth/wrong-password"
        ? "ID หรือรหัสไม่ถูกต้อง"
        : loginError.message || "เข้าสู่ระบบไม่สำเร็จ";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="panel login-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Green Mech Scoring</p>
          <h1>เข้าสู่ระบบ</h1>
        </div>

        <label>
          ID
          <select value={id} onChange={(event) => setId(event.target.value)}>
            {LOGIN_IDS.map((loginId) => (
              <option key={loginId} value={loginId}>{loginId}</option>
            ))}
          </select>
        </label>

        <label>
          รหัส
          <input
            autoComplete="current-password"
            inputMode="numeric"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="danger login-error">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button>
      </form>
    </main>
  );
}

function LoadingPage({ message }) {
  return (
    <main className="login-shell">
      <section className="panel login-card">
        <div>
          <p className="eyebrow">Green Mech Scoring</p>
          <h1>{message}</h1>
        </div>
      </section>
    </main>
  );
}

function SyncBanner({ status, error }) {
  return (
    <div className={error ? "sync-banner error" : "sync-banner"}>
      <strong>{status}</strong>
      {error ? <span>{error}</span> : null}
    </div>
  );
}

function SaveCompletePage({ result, levelId, onNext, onList }) {
  return (
    <main className={`app-shell save-complete-shell level-theme-${levelId}`}>
      <section className="panel save-complete-card">
        <div>
          <p className="eyebrow">บันทึกสำเร็จ</p>
          <h1>{result.savedTeam.name}</h1>
        </div>

        <div className="save-total">
          <span>คะแนนรวม</span>
          <strong>{result.total}</strong>
        </div>

        <div className="save-next">
          <span>ทีมถัดไป</span>
          <strong>{result.nextTeam ? result.nextTeam.name : "ครบทุกทีมแล้ว"}</strong>
        </div>

        <div className="save-actions">
          <button disabled={!result.nextTeam} onClick={onNext}>ให้คะแนนทีมถัดไป</button>
          <button className="ghost" onClick={onList}>กลับรายชื่อทีม</button>
        </div>
      </section>
    </main>
  );
}

function LevelTabs({ levelId, setLevelId }) {
  return (
    <nav className="tabs" aria-label="levels">
      {LEVELS.map((level) => (
        <button key={level.id} className={level.id === levelId ? "active" : ""} onClick={() => setLevelId(level.id)}>
          {level.shortLabel}
        </button>
      ))}
    </nav>
  );
}

function JudgePage({ teams, scores, assignment, pkOrders, onScore }) {
  const isEnabled = assignment?.enabled !== false;
  return (
    <section className="stack">
      <div className="summary-row">
        <Metric label="ทีมทั้งหมด" value={teams.length} />
        <Metric label="จบแล้ว" value={teams.filter((team) => team.status === "main-complete").length} />
        <Metric label="ยังไม่จบ" value={teams.filter((team) => team.status !== "main-complete").length} />
      </div>
      {assignment ? (
        <section className={isEnabled ? "panel assignment-note" : "panel assignment-note disabled"}>
          <strong>{isEnabled ? `ช่วงทีมที่รับผิดชอบ: ${assignment.from || 1}-${assignment.to || 999}` : "ID นี้ยังไม่ได้เปิดให้ลงคะแนน"}</strong>
          {pkOrders?.length ? <span>PK ที่ได้รับมอบหมาย: ทีมลำดับ {pkOrders.join(", ")}</span> : null}
        </section>
      ) : null}
      <div className="team-list">
        {teams.map((team) => (
          <article key={team.id} className="team-row">
            <div className="team-order">{team.order}</div>
            <div className="team-main">
              <strong>{team.teamName || team.name}</strong>
              <span>{team.school || "ไม่ระบุโรงเรียน"}</span>
              <span>{scores[team.id] ? `ตรวจแล้ว • ยิงครบ 3 ครั้ง • ${scores[team.id].total} คะแนน` : "รอให้คะแนน"}</span>
            </div>
            <button className={scores[team.id] ? "edit-score-button" : ""} onClick={() => onScore(team)}>
              {scores[team.id] ? "แก้คะแนน" : "เริ่มให้คะแนน"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminPage({ levelId, teams, scores, auditLogs, settings, isCloudReady, setupStatus, awardCutoff, setAwardCutoff, pkPolicy, setPkPolicy, onSaveTeamSetup, onResetScores, onSaveSettings }) {
  const [adminTab, setAdminTab] = useState("dashboard");
  const [pkSettingsStatus, setPkSettingsStatus] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [selectedPkTeamIds, setSelectedPkTeamIds] = useState([]);
  const completed = teams.filter((team) => scores[team.id]);
  const mainRanking = sortTeamsForResults(teams);
  const pkNeeds = completed.length === teams.length ? pkNeededForMain(completed, awardCutoff, pkPolicy) : [];
  const pkTeamIds = new Set(pkNeeds.flatMap((need) => need.teamIds));
  const pkTeams = teams.filter((team) => pkTeamIds.has(team.id)).sort((a, b) => a.order - b.order);
  const selectedPkTeams = pkTeams.filter((team) => selectedPkTeamIds.includes(team.id));
  const pkRounds = settings.pkRoundsByLevel?.[levelId] || {};

  useEffect(() => {
    setSelectedPkTeamIds(pkTeams.map((team) => team.id));
  }, [levelId, pkTeams.map((team) => team.id).join("|")]);

  const savePkSettings = async () => {
    if (!window.confirm(`ยืนยันบันทึกตั้งค่า PK ของ ${LEVEL_LABELS[levelId]} หรือไม่?`)) return;
    const pkConfigByLevel = {
      ...(settings.pkConfigByLevel || {}),
      [levelId]: { awardCutoff, pkPolicy },
    };
    await onSaveSettings({ pkConfigByLevel });
    setPkSettingsStatus("บันทึกตั้งค่า PK แล้ว");
  };

  const resetLevelScores = async () => {
    setResetStatus("");
    try {
      const didReset = await onResetScores();
      if (didReset) setResetStatus("รีเซ็ตคะแนนระดับนี้แล้ว พร้อมให้กรรมการทดสอบใหม่");
    } catch (error) {
      setResetStatus(error.message || "รีเซ็ตคะแนนไม่สำเร็จ");
    }
  };

  const markCurrentPkRound = async () => {
    if (!selectedPkTeams.length) return;
    const nextRound = Math.max(0, ...selectedPkTeams.flatMap((team) => (pkRounds[team.id] || []).map(Number).filter(Boolean))) + 1;
    if (!window.confirm(`ยืนยันบันทึก ${selectedPkTeams.length} ทีมนี้เป็น PK${nextRound} หรือไม่?`)) return;
    const nextLevelRounds = { ...pkRounds };
    selectedPkTeams.forEach((team) => {
      nextLevelRounds[team.id] = [...new Set([...(nextLevelRounds[team.id] || []), nextRound])].sort((a, b) => a - b);
    });
    await onSaveSettings({
      pkRoundsByLevel: {
        ...(settings.pkRoundsByLevel || {}),
        [levelId]: nextLevelRounds,
      },
    });
  };

  return (
    <section className="stack">
      <nav className="admin-tabs" aria-label="admin sections">
        <button className={adminTab === "dashboard" ? "active" : ""} onClick={() => setAdminTab("dashboard")}>Dashboard</button>
        <button className={adminTab === "teams" ? "active" : ""} onClick={() => setAdminTab("teams")}>ทีม</button>
        <button className={adminTab === "judges" ? "active" : ""} onClick={() => setAdminTab("judges")}>กรรมการ</button>
        <button className={adminTab === "pk" ? "active" : ""} onClick={() => setAdminTab("pk")}>PK</button>
        <button className={adminTab === "print" ? "active" : ""} onClick={() => setAdminTab("print")}>พิมพ์ผล</button>
      </nav>

      <div className="summary-row">
        <Metric label="ทีม" value={teams.length} />
        <Metric label="จบรอบแรก" value={completed.length} />
        <Metric label="ยังไม่จบ" value={teams.length - completed.length} />
      </div>

      {adminTab === "teams" ? <TeamSetupPanel levelId={levelId} teams={teams} status={setupStatus} onSave={onSaveTeamSetup} /> : null}

      {adminTab === "judges" ? (
        <JudgeAssignmentPanel
          levelId={levelId}
          teams={teams}
          assignments={settings.judgeAssignments || {}}
          onSave={(judgeAssignments) => onSaveSettings({ judgeAssignments })}
        />
      ) : null}

      {adminTab === "pk" ? (
        <>
          <PkSettingsPanel
            levelId={levelId}
            awardCutoff={awardCutoff}
            setAwardCutoff={setAwardCutoff}
            pkPolicy={pkPolicy}
            setPkPolicy={setPkPolicy}
            status={pkSettingsStatus}
            setStatus={setPkSettingsStatus}
            onSave={savePkSettings}
          />
          <PkStatusPanel
            allTeamsComplete={completed.length === teams.length}
            pkNeeds={pkNeeds}
            pkTeams={pkTeams}
            pkRounds={pkRounds}
            selectedTeamIds={selectedPkTeamIds}
            onSelectedTeamIdsChange={setSelectedPkTeamIds}
            onMarkRound={markCurrentPkRound}
          />
          <PkAssignmentPanel
            levelId={levelId}
            pkTeams={selectedPkTeams}
            pkNeeds={pkNeeds}
            allTeamsComplete={completed.length === teams.length}
            assignments={settings.judgeAssignments || {}}
            pkAssignments={settings.pkAssignments || {}}
            onSave={(pkAssignments) => onSaveSettings({ pkAssignments })}
          />
        </>
      ) : null}

      {adminTab === "print" ? <PrintResultsPage levelId={levelId} teams={mainRanking} scores={scores} pkRounds={pkRounds} /> : null}

      {adminTab === "dashboard" ? (
        <>
          <section className="panel">
            <h2>{LEVEL_LABELS[levelId]} Main Summary</h2>
            {completed.length === 0 ? (
              <p className="muted">ยังไม่มีคะแนนที่บันทึกในระดับนี้</p>
            ) : completed.length !== teams.length ? (
              <p className="muted">มีคะแนนแล้ว {completed.length}/{teams.length} ทีม</p>
            ) : (
              <p className="ok">ครบแล้ว ครูกดเริ่ม PK ได้</p>
            )}
            <div className="ranking">
              {mainRanking.map((team, index) => (
                <div key={team.id}>
                  <span>
                    {index + 1}. {team.teamName || team.name}{team.school ? ` • ${team.school}` : ""}
                    <PkBadges labels={pkRoundLabels(pkRounds, team.id)} />
                  </span>
                  <strong>{team.mainTotal ?? "-"} คะแนน</strong>
                </div>
              ))}
            </div>
          </section>

          {!isCloudReady ? (
            <section className="panel cloud-warning">
              <strong>ยังไม่ได้เชื่อมฐานข้อมูลกลาง</strong>
              <span>Admin หน้านี้ดูข้อมูลที่อยู่ในเครื่อง/เบราว์เซอร์นี้ได้ แต่จะยังไม่เห็นคะแนนจากมือถือเครื่องอื่นจนกว่าจะใส่ค่า Firebase ให้ GitHub Pages</span>
            </section>
          ) : null}

          <section className="panel reset-panel">
            <div>
              <p className="eyebrow">Test Reset</p>
              <h2>รีเซ็ตคะแนน {LEVEL_LABELS[levelId]}</h2>
            </div>
            <p className="muted">ใช้สำหรับวันทดสอบหรือก่อนเริ่มจริง ล้างเฉพาะคะแนนรอบแรกของระดับนี้ รายชื่อทีมและชื่อกรรมการยังอยู่เหมือนเดิม</p>
            <div className="setup-actions">
              <p className={resetStatus.includes("ไม่สำเร็จ") ? "danger" : "muted"}>{resetStatus || `มีคะแนนแล้ว ${completed.length}/${teams.length} ทีม`}</p>
              <button className="danger-button" disabled={completed.length === 0} onClick={resetLevelScores}>รีเซ็ตคะแนนระดับนี้</button>
            </div>
          </section>

          <section className="panel">
            <h2>Audit Log</h2>
            <div className="audit-list">
              {auditLogs.map((log) => (
                <div key={log.id}>
                  <strong>{log.action}</strong>
                  <span>{log.team} • {log.judge} • {new Date(log.at).toLocaleString("th-TH")}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

function JudgeAssignmentPanel({ levelId, teams, assignments, onSave }) {
  const judgeIds = JUDGE_IDS_BY_LEVEL[levelId] || [];
  const [draft, setDraft] = useState(() => ({ ...defaultSettings().judgeAssignments, ...assignments }));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft({ ...defaultSettings().judgeAssignments, ...assignments });
  }, [assignments, levelId]);

  const updateJudge = (judgeId, patch) => {
    setDraft((current) => ({
      ...current,
      [judgeId]: { ...current[judgeId], ...patch },
    }));
  };

  const handleSave = async () => {
    if (!window.confirm("ยืนยันบันทึกการมอบหมายกรรมการหรือไม่?")) return;
    const nextAssignments = { ...assignments, ...draft };
    await onSave(nextAssignments);
    setStatus("บันทึกการมอบหมายแล้ว");
  };

  return (
    <section className="panel assignment-panel">
      <div>
        <p className="eyebrow">Judge Assignment</p>
        <h2>กำหนดทีมให้ ID กรรมการ</h2>
      </div>
      <div className="assignment-grid">
        {judgeIds.map((judgeId) => {
          const assignment = draft[judgeId] || { enabled: true, judgeName: "", from: 1, to: teams.length || 1, pkTeamOrder: "" };
          const enabled = assignment.enabled !== false;
          return (
            <div key={judgeId} className={enabled ? "assignment-row" : "assignment-row disabled"}>
              <strong>{judgeId}</strong>
              <label className="check-row assignment-enabled">
                <input type="checkbox" checked={enabled} onChange={(event) => updateJudge(judgeId, { enabled: event.target.checked })} />
                เปิดใช้
              </label>
              <label>
                ชื่อกรรมการ
                <input value={assignment.judgeName || ""} onChange={(event) => updateJudge(judgeId, { judgeName: event.target.value })} placeholder="เช่น ครูสมชาย" />
              </label>
              <label>
                จากทีม
                <input disabled={!enabled} inputMode="numeric" type="number" min="1" max={teams.length || 999} value={assignment.from || ""} onChange={(event) => updateJudge(judgeId, { from: Number(event.target.value) })} />
              </label>
              <label>
                ถึงทีม
                <input disabled={!enabled} inputMode="numeric" type="number" min="1" max={teams.length || 999} value={assignment.to || ""} onChange={(event) => updateJudge(judgeId, { to: Number(event.target.value) })} />
              </label>
            </div>
          );
        })}
      </div>
      <div className="setup-actions">
        <p className="muted">{status || "กำหนดช่วงทีมที่แต่ละ ID มองเห็น และเลือกทีม PK ได้ ID ละ 1 ทีม"}</p>
        <button onClick={handleSave}>บันทึกการมอบหมาย</button>
      </div>
    </section>
  );
}

function PkBadges({ labels }) {
  if (!labels.length) return null;
  return (
    <span className="pk-badges">
      {labels.map((label) => <b key={label}>{label}</b>)}
    </span>
  );
}

function PkSettingsPanel({ levelId, awardCutoff, setAwardCutoff, pkPolicy, setPkPolicy, status, setStatus, onSave }) {
  return (
    <section className="panel">
      <div>
        <p className="eyebrow">PK Setup</p>
        <h2>ตั้งค่า PK {LEVEL_LABELS[levelId]}</h2>
      </div>
      <div className="form-grid">
        <label>
          ให้รางวัลถึงอันดับที่
          <select value={awardCutoff} onChange={(event) => {
            setAwardCutoff(Number(event.target.value));
            setStatus("");
          }}>
            {Array.from({ length: 18 }, (_, index) => index + 3).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Mode
          <select value={pkPolicy} onChange={(event) => {
            setPkPolicy(event.target.value);
            setStatus("");
          }}>
            <option value={PK_POLICY.podiumCutoff}>Podium + Award Cutoff</option>
            <option value={PK_POLICY.exactRanking}>Exact Ranking 1-N</option>
          </select>
        </label>
      </div>
      <div className="setup-actions">
        <p className="muted">{status || "เปลี่ยนค่าแล้วต้องกดบันทึก เพื่อให้ admin เปิดใหม่แล้วยังใช้ค่าเดิม"}</p>
        <button onClick={onSave}>บันทึกตั้งค่า PK</button>
      </div>
    </section>
  );
}

function PkStatusPanel({ allTeamsComplete, pkNeeds, pkTeams, pkRounds, selectedTeamIds, onSelectedTeamIdsChange, onMarkRound }) {
  const selected = new Set(selectedTeamIds);
  const toggleTeam = (teamId) => {
    onSelectedTeamIdsChange((current) => (
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId]
    ));
  };

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">PK Result</p>
        <h2>ผลและสถานะ PK</h2>
      </div>
      {!allTeamsComplete ? <p className="muted">ยังให้คะแนนรอบแรกไม่ครบทุกทีม ระบบจะแสดงผล PK หลังคะแนนครบ</p> : null}
      {allTeamsComplete && !pkNeeds.length ? <p className="ok">ไม่ต้อง PK ตาม policy ปัจจุบัน</p> : null}
      {pkNeeds.length ? (
        <div className="pk-status-list">
          {pkNeeds.map((need) => (
            <div key={need.teamIds.join("-")} className="pk-card">
              <strong>ต้อง PK ชิงอันดับ {need.placeStart}-{need.placeEnd}</strong>
              <span>{need.teamIds.length} ทีม • Main {need.score}</span>
            </div>
          ))}
        </div>
      ) : null}
      {pkTeams.length ? (
        <div className="pk-result-list">
          {pkTeams.map((team) => (
            <div key={team.id}>
              <label className="pk-round-team">
                <input type="checkbox" checked={selected.has(team.id)} onChange={() => toggleTeam(team.id)} />
                <span>{team.order}. {team.teamName || team.name}</span>
              </label>
              <PkBadges labels={pkRoundLabels(pkRounds, team.id)} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="setup-actions">
        <p className="muted">ติ๊กเฉพาะทีมที่ต้องยิงรอบนี้ เช่น PK1 เลือกทุกทีมที่เสมอ ถ้ายังเสมอต่อ PK2 ให้เหลือเฉพาะทีมที่ยังเสมอ</p>
        <button disabled={!selectedTeamIds.length} onClick={onMarkRound}>บันทึกรอบ PK ของทีมที่ติ๊กไว้</button>
      </div>
    </section>
  );
}

function PkAssignmentPanel({ levelId, pkTeams, pkNeeds, allTeamsComplete, assignments, pkAssignments, onSave }) {
  const judgeIds = JUDGE_IDS_BY_LEVEL[levelId] || [];
  const [draft, setDraft] = useState(() => ({ ...pkAssignments }));
  const [status, setStatus] = useState("");
  const pkOrders = useMemo(() => new Set(pkTeams.map((team) => team.order)), [pkTeams]);

  useEffect(() => {
    const next = { ...pkAssignments };
    judgeIds.forEach((judgeId) => {
      if (!Array.isArray(next[judgeId]) && assignments[judgeId]?.pkTeamOrder) {
        next[judgeId] = [Number(assignments[judgeId].pkTeamOrder)];
      }
      if (!Array.isArray(next[judgeId])) next[judgeId] = [];
      next[judgeId] = next[judgeId].map(Number).filter((order) => pkOrders.has(order));
    });
    setDraft(next);
  }, [assignments, judgeIds, pkAssignments, pkOrders]);

  const toggleTeam = (judgeId, order) => {
    setDraft((current) => {
      const currentOrders = new Set((current[judgeId] || []).map(Number));
      if (currentOrders.has(order)) currentOrders.delete(order);
      else currentOrders.add(order);
      return { ...current, [judgeId]: [...currentOrders].sort((a, b) => a - b) };
    });
  };

  const handleSave = async () => {
    if (!window.confirm("ยืนยันบันทึกมอบหมาย PK หรือไม่?")) return;
    await onSave(draft);
    setStatus("บันทึกมอบหมาย PK แล้ว");
  };

  return (
    <section className="panel pk-assignment-panel">
      <div>
        <p className="eyebrow">PK Assignment</p>
        <h2>มอบหมายทีม PK ให้กรรมการ</h2>
      </div>
      {!allTeamsComplete ? <p className="muted">ยังให้คะแนนรอบแรกไม่ครบทุกทีม ระบบจะแสดงทีม PK หลังคะแนนครบ</p> : null}
      {allTeamsComplete && !pkTeams.length ? <p className="ok">ไม่พบทีมที่ต้อง PK ตาม policy ปัจจุบัน</p> : null}
      {pkNeeds.length ? (
        <div className="pk-need-list">
          {pkNeeds.map((need) => (
            <div key={`${need.score}-${need.teamIds.join("-")}`}>
              <strong>อันดับ {need.placeStart}-{need.placeEnd}</strong>
              <span>Main {need.score} • {need.teamIds.length} ทีม</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pk-assignment-list">
        {judgeIds.map((judgeId) => {
          const assignment = assignments[judgeId] || {};
          const enabled = assignment.enabled !== false;
          const selected = new Set((draft[judgeId] || []).map(Number));
          return (
            <article key={judgeId} className={enabled ? "pk-assignment-row" : "pk-assignment-row disabled"}>
              <div className="pk-judge-head">
                <strong>{judgeId}</strong>
                <span>{assignment.judgeName || "ยังไม่ใส่ชื่อกรรมการ"}</span>
              </div>
              <div className="pk-team-grid">
                {pkTeams.map((team) => (
                  <label key={`${judgeId}-${team.id}`} className={selected.has(team.order) ? "pk-team-chip active" : "pk-team-chip"}>
                    <input disabled={!enabled} type="checkbox" checked={selected.has(team.order)} onChange={() => toggleTeam(judgeId, team.order)} />
                    <span>{team.order}. {team.teamName || team.name}</span>
                  </label>
                ))}
                {!pkTeams.length ? <p className="muted">ยังไม่มีทีมให้เลือก</p> : null}
              </div>
            </article>
          );
        })}
      </div>
      <div className="setup-actions">
        <p className="muted">{status || "เลือกได้หลายทีมต่อกรรมการ เพื่อแบ่งงาน PK พร้อมกัน"}</p>
        <button onClick={handleSave}>บันทึกมอบหมาย PK</button>
      </div>
    </section>
  );
}

function PrintResultsPage({ levelId, teams, scores, pkRounds }) {
  const completed = teams.filter((team) => scores[team.id]);
  let scoredRank = 0;
  return (
    <section className="panel print-results">
      <div className="print-actions">
        <div>
          <p className="eyebrow">Print</p>
          <h2>ผลการแข่งขัน {LEVEL_LABELS[levelId]}</h2>
        </div>
        <button onClick={() => window.print()}>พิมพ์ผล</button>
      </div>
      <div className="print-summary">
        <Metric label="ทีมทั้งหมด" value={teams.length} />
        <Metric label="มีคะแนน" value={completed.length} />
        <Metric label="รอคะแนน" value={teams.length - completed.length} />
      </div>
      <p className="print-note">ตารางนี้เรียงคะแนนสูงสุดไว้ด้านบน ทีมที่ยังไม่มีคะแนนจะแสดงท้ายตารางและยังไม่ถูกจัดอันดับ</p>
      <table className="results-table">
        <thead>
          <tr>
            <th>อันดับ</th>
            <th>ลำดับทีม</th>
            <th>โรงเรียน</th>
            <th>ทีม</th>
            <th>PK</th>
            <th>คะแนน</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => {
            const hasScore = Number.isFinite(team.mainTotal);
            if (hasScore) scoredRank += 1;
            return (
              <tr key={team.id} className={hasScore ? "" : "unscored-row"}>
                <td>{hasScore ? scoredRank : "-"}</td>
                <td>{team.order}</td>
                <td>{team.school || "-"}</td>
                <td>{team.teamName || team.name}</td>
                <td><PkBadges labels={pkRoundLabels(pkRounds, team.id)} /></td>
                <td>{team.mainTotal ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TeamSetupPanel({ levelId, teams, status, onSave }) {
  const [count, setCount] = useState(teams.length);
  const [entries, setEntries] = useState(() => teams.map((team) => ({
    order: team.order,
    school: team.school || "",
    teamName: team.teamName || team.name,
  })));
  const [importText, setImportText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCount(teams.length);
    setEntries(teams.map((team) => ({
      order: team.order,
      school: team.school || "",
      teamName: team.teamName || team.name,
    })));
  }, [levelId, teams]);

  const names = useMemo(() => entries.map((entry) => `${entry.school.trim()} - ${entry.teamName.trim()}`.trim()), [entries]);
  const duplicates = useMemo(() => names.filter((name, index) => name && names.indexOf(name) !== index), [names]);
  const hasBlank = entries.some((entry) => !entry.school.trim() || !entry.teamName.trim());

  const updateCount = (nextCount) => {
    setCount(nextCount);
    setEntries((current) => Array.from({ length: nextCount }, (_, index) => current[index] || { order: index + 1, school: "", teamName: `ทีม ${index + 1}` }));
  };

  const updateEntry = (index, patch) => {
    setEntries((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)));
  };

  const parseImportText = () => {
    try {
      const parsed = importText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const parts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
            return { order: Number(parts[0]), school: parts[1], teamName: parts.slice(2).join(" ") };
          }
          const fallbackParts = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
          if (fallbackParts.length >= 3 && /^\d+$/.test(fallbackParts[0])) {
            return { order: Number(fallbackParts[0]), school: fallbackParts[1], teamName: fallbackParts.slice(2).join(" ") };
          }
          throw new Error(`อ่านบรรทัดที่ ${index + 1} ไม่ได้`);
        })
        .sort((a, b) => a.order - b.order);
      setEntries(parsed);
      setCount(parsed.length);
      setError("");
    } catch (parseError) {
      setError(parseError.message || "แปลงรายชื่อไม่สำเร็จ");
    }
  };

  const handleSave = async () => {
    if (!window.confirm(`ยืนยันบันทึกรายชื่อ ${count} ทีมหรือไม่?`)) return;
    setIsSaving(true);
    setError("");
    try {
      await onSave(entries);
    } catch (saveError) {
      setError(saveError.message || "บันทึกรายชื่อทีมไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="panel team-setup">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Admin Setup</p>
          <h2>ตั้งค่าจำนวนและชื่อทีม</h2>
        </div>
        <label>
          จำนวนทีม
          <select value={count} onChange={(event) => updateCount(Number(event.target.value))}>
            {Array.from({ length: 31 }, (_, value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="import-box">
        วางรายชื่อจาก Excel/ชีต
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="1	โรงเรียนวังโป่งพิทยาคม	ทีม Sigma Promax"
          rows={5}
        />
        <button type="button" className="ghost" disabled={!importText.trim()} onClick={parseImportText}>แปลงรายชื่อ</button>
      </label>

      <div className="team-name-grid">
        {entries.map((entry, index) => (
          <label key={`${levelId}-${index + 1}`}>
            ทีมที่ {index + 1}
            <input value={entry.school} onChange={(event) => updateEntry(index, { school: event.target.value })} placeholder="โรงเรียน" />
            <input value={entry.teamName} onChange={(event) => updateEntry(index, { teamName: event.target.value })} placeholder="ชื่อทีม" />
          </label>
        ))}
      </div>

      <div className="setup-actions">
        <p className={error || duplicates.length || hasBlank ? "danger" : "muted"}>
          {error || (hasBlank ? "ยังมีชื่อทีมว่าง" : duplicates.length ? `ชื่อซ้ำ: ${[...new Set(duplicates)].join(", ")}` : status || `พร้อมบันทึก ${count} ทีม`)}
        </p>
        <button disabled={isSaving || hasBlank || duplicates.length > 0} onClick={handleSave}>{isSaving ? "กำลังบันทึก..." : "บันทึกตั้งค่าทีม"}</button>
      </div>
    </section>
  );
}

function ScoreWizard({ levelId, team, existing, onCancel, onSave }) {
  const [deviceCount, setDeviceCount] = useState(existing?.deviceCount ?? null);
  const [shots, setShots] = useState(existing?.shots ?? [blankShot(true), blankShot(false), blankShot(false)]);
  const [reason, setReason] = useState("");
  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const draft = { deviceCount, shots };
  const breakdown = mainScore(draft);
  const steps = buildWizardSteps();
  const activeStep = steps[step];
  const isLastStep = step === steps.length - 1;
  const currentStepReady = wizardStepReady(activeStep, deviceCount, shots);
  const allShotsReady = Number.isInteger(deviceCount) && shots.every((shot, index) => shotReady(shot, index));
  const firstIncompleteStep = findFirstIncompleteStep(steps, deviceCount, shots);
  const saveDisabled = !allShotsReady;

  const updateShot = (index, patch) => {
    setShots((current) => current.map((shot, shotIndex) => (shotIndex === index ? { ...shot, ...patch } : shot)));
  };

  const handleSave = async () => {
    if (!window.confirm(`ยืนยันบันทึกคะแนน ${team.teamName || team.name} หรือไม่?`)) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onSave(team, draft, reason);
    } catch (error) {
      setSaveError(error.message || "บันทึกไม่สำเร็จ");
      setIsSaving(false);
    }
  };

  return (
    <main className={`app-shell wizard-shell level-theme-${levelId}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow team-heading">{team.teamName || team.name}</p>
          {team.school ? <p className="school-heading">{team.school}</p> : null}
          <h1>ให้คะแนนรอบแรก</h1>
        </div>
        <button className="ghost" onClick={onCancel}>ปิด</button>
      </header>

      <WizardProgress step={step} steps={steps} setStep={setStep} />

      {activeStep.type === "device" ? <DeviceStep value={deviceCount} onChange={setDeviceCount} /> : null}
      {activeStep.type === "shot" ? (
        <ShotStepCard
          phase={activeStep.phase}
          index={activeStep.shotIndex}
          shot={shots[activeStep.shotIndex]}
          onChange={(patch) => updateShot(activeStep.shotIndex, patch)}
        />
      ) : null}
      {activeStep.type === "shotSummary" ? (
        <ShotSummaryStep
          index={activeStep.shotIndex}
          shot={shots[activeStep.shotIndex]}
          breakdown={breakdown.shots[activeStep.shotIndex]}
        />
      ) : null}
      {activeStep.type === "summary" ? (
        <SummaryStep
          existing={existing}
          reason={reason}
          setReason={setReason}
          deviceCount={deviceCount}
          shots={shots}
          breakdown={breakdown}
          firstIncompleteStep={firstIncompleteStep}
          goToStep={setStep}
        />
      ) : null}

      <section className="sticky-total">
        <div>
          <span>Total</span>
          <strong>{breakdown.total}</strong>
        </div>
        <div className="wizard-actions">
          <button className="ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>ย้อนกลับ</button>
          {isLastStep ? (
            <button disabled={saveDisabled || isSaving} onClick={handleSave}>{isSaving ? "กำลังบันทึก..." : "บันทึก / ทีมถัดไป"}</button>
          ) : (
            <button disabled={!currentStepReady} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>ถัดไป</button>
          )}
          {isLastStep && saveDisabled ? (
            <span className="save-hint">ยังไม่ครบ: {firstIncompleteStep?.step.title}</span>
          ) : null}
          {saveError ? <span className="save-hint">{saveError}</span> : null}
        </div>
      </section>
    </main>
  );
}

function buildWizardSteps() {
  const shotSteps = [0, 1, 2].flatMap((shotIndex) => [
    { type: "shot", shotIndex, phase: "position", shortLabel: `${shotIndex + 1}.1`, title: `ยิงครั้งที่ ${shotIndex + 1}: ตำแหน่งลูกบอล` },
    { type: "shot", shotIndex, phase: "distance", shortLabel: `${shotIndex + 1}.2`, title: `ยิงครั้งที่ ${shotIndex + 1}: ระยะยิง` },
    { type: "shot", shotIndex, phase: "operation", shortLabel: `${shotIndex + 1}.3`, title: `ยิงครั้งที่ ${shotIndex + 1}: การทำงาน` },
    { type: "shot", shotIndex, phase: "score", shortLabel: `${shotIndex + 1}.4`, title: `ยิงครั้งที่ ${shotIndex + 1}: คะแนนพื้นที่` },
    { type: "shotSummary", shotIndex, shortLabel: `${shotIndex + 1}.ส`, title: `สรุปการยิงครั้งที่ ${shotIndex + 1}` },
  ]);
  return [
    { type: "device", shortLabel: "1", title: "เลือกจำนวนอุปกรณ์" },
    ...shotSteps,
    { type: "summary", shortLabel: "สรุป", title: "สรุปคะแนน" },
  ];
}

function WizardProgress({ step, steps, setStep }) {
  const active = steps[step];
  return (
    <section className="wizard-progress">
      <div>
        <span>ขั้นตอน {step + 1}/{steps.length}</span>
        <strong>{active.title}</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
      <nav className="wizard-steps" aria-label="ขั้นตอนให้คะแนน">
        {steps.map((item, index) => (
          <button key={`${item.shortLabel}-${index}`} className={step === index ? "active" : ""} onClick={() => setStep(index)}>
            {item.shortLabel}
          </button>
        ))}
      </nav>
    </section>
  );
}

function wizardStepReady(step, deviceCount, shots) {
  if (step.type === "summary") return true;
  if (step.type === "device") return Number.isInteger(deviceCount);
  if (step.type === "shotSummary") return shotReady(shots[step.shotIndex], step.shotIndex);
  const shot = shots[step.shotIndex];
  if (step.phase === "position") return shot?.target === TARGETS.launcher || shot?.target === TARGETS.point3;
  if (step.phase === "distance") return shot?.distancePassed === true || shot?.distancePassed === false;
  if (step.phase === "operation") return operationReady(shot, step.shotIndex);
  if (step.phase === "score") return scoreReady(shot);
  return false;
}

function targetLabel(target) {
  if (target === TARGETS.launcher) return "เครื่องยิง";
  if (target === TARGETS.point3) return "จุดที่ 3";
  return "ยังไม่เลือก";
}

function findFirstIncompleteStep(steps, deviceCount, shots) {
  const index = steps.findIndex((item) => item.type !== "summary" && !wizardStepReady(item, deviceCount, shots));
  return index >= 0 ? { index, step: steps[index] } : null;
}

function shotReady(shot, index) {
  if (!shot) return false;
  if (shot.target !== TARGETS.launcher && shot.target !== TARGETS.point3) return false;
  if (shot.distancePassed !== true && shot.distancePassed !== false) return false;
  if (shot.distancePassed === false) return true;
  if (!operationReady(shot, index)) return false;
  return scoreReady(shot);
}

function operationReady(shot, index) {
  if (!shot) return false;
  if (shot.distancePassed === false) return true;
  if (shot.distancePassed !== true) return false;
  if (index === 0 && !smoothnessReady(shot)) return false;
  if (shot.autoLaunch !== true && shot.autoLaunch !== false) return false;
  return shot.touches?.every((value) => value === true || value === false) ?? false;
}

function scoreReady(shot) {
  if (!shot) return false;
  if (shot.distancePassed === false) return true;
  if (shot.distancePassed !== true) return false;
  if (shot.target !== TARGETS.launcher && shot.target !== TARGETS.point3) return false;
  if (!shot.touches?.every((value) => value === true || value === false)) return false;
  return shot.touches.every((touched, ballIndex) => touched || shot.results?.[ballIndex] !== null);
}

function DeviceStep({ value, onChange }) {
  return (
    <section className="panel scoring-step device-step">
      <div>
        <p className="eyebrow">ก่อนยิง</p>
        <h2>จำนวนอุปกรณ์</h2>
      </div>
      <p className="muted">เลือกจำนวนอุปกรณ์ที่ใช้ คะแนนสูงสุด 5</p>
      <ChoiceGrid columns={3}>
        {Array.from({ length: 6 }, (_, count) => (
          <button key={count} className={value === count ? "choice active" : "choice"} onClick={() => onChange(count)}>
            {count}
          </button>
        ))}
      </ChoiceGrid>
    </section>
  );
}

function SummaryStep({ existing, reason, setReason, deviceCount, shots, breakdown, firstIncompleteStep, goToStep }) {
  return (
    <section className="panel scoring-step summary-step">
      <div>
        <p className="eyebrow">ตรวจสอบก่อนบันทึก</p>
        <h2>สรุปคะแนน</h2>
      </div>
      <div className="summary-cards">
        <Metric label="อุปกรณ์" value={deviceCount} />
        <Metric label="Smoothness" value={breakdown.smoothness} />
        <Metric label="Auto" value={breakdown.autoTotal} />
        <Metric label="Mission" value={breakdown.missionTotal} />
      </div>
      <div className="ranking">
        {shots.map((shot, index) => {
          const shotBreakdown = breakdown.shots[index];
          return (
            <div key={index}>
              <span>ยิงครั้งที่ {index + 1} • {targetLabel(shot.target)}</span>
              <strong>{shotBreakdown.total} คะแนน</strong>
            </div>
          );
        })}
      </div>
      {firstIncompleteStep ? (
        <div className="incomplete-box">
          <strong>ยังบันทึกไม่ได้</strong>
          <span>ยังไม่ครบ: {firstIncompleteStep.step.title}</span>
          <button onClick={() => goToStep(firstIncompleteStep.index)}>ไปแก้ขั้นนี้</button>
        </div>
      ) : null}
      {existing ? (
        <label>
          เหตุผลการแก้คะแนน
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="ถ้ามี" />
        </label>
      ) : null}
    </section>
  );
}

function ShotSummaryStep({ index, shot, breakdown }) {
  return (
    <section className="panel scoring-step shot-summary-step">
      <div className="shot-title">
        <div>
          <p className="eyebrow">ตรวจสอบก่อนครั้งถัดไป</p>
          <h2>สรุปการยิงครั้งที่ {index + 1}</h2>
        </div>
        <strong>{breakdown.total} คะแนน</strong>
      </div>

      <div className="shot-summary-grid">
        <Metric label="ตำแหน่ง" value={targetLabel(shot.target)} />
        <Metric label="ระยะยิง" value={shot.distancePassed ? "ผ่าน" : "ไม่ผ่าน"} />
        {breakdown.smoothness !== null ? <Metric label="ราบรื่น" value={breakdown.smoothness} /> : null}
        <Metric label="ออโต้" value={breakdown.auto} />
        <Metric label="พื้นที่" value={breakdown.mission} />
        <Metric label="รวมครั้งนี้" value={breakdown.total} />
      </div>

      <div className="step-note">
        <p className="muted">กดถัดไปเพื่อไป{index < 2 ? `การยิงครั้งที่ ${index + 2}` : "สรุปรวมและบันทึก"}</p>
      </div>
    </section>
  );
}

function ShotStepCard({ index, phase, shot, onChange }) {
  const mission = missionScore(shot);
  const smooth = index === 0 && smoothnessReady(shot) ? smoothnessScore(shot.handCount, shot.droppedPartsCount) : null;
  const phaseTitles = {
    position: "ตำแหน่งลูกบอลที่ยิง",
    distance: "ระยะยิง",
    operation: index === 0 ? "ความราบรื่นและการทำงาน" : "การทำงาน",
    score: "คะแนนพื้นที่",
  };

  return (
    <section className={`panel shot-panel scoring-step phase-${phase}`}>
      <div className="shot-title">
        <div>
          <p className="eyebrow">รอบแรก</p>
          <h2>ยิงครั้งที่ {index + 1}</h2>
        </div>
        <strong>{mission} คะแนน</strong>
      </div>

      <section className="score-section single-card">
        <h3>{phaseTitles[phase]}</h3>
        {phase === "position" ? (
          <ChoiceGrid columns={2}>
            <button className={shot.target === TARGETS.launcher ? "choice active" : "choice"} onClick={() => onChange({ target: TARGETS.launcher, results: [null, null] })}>
              เครื่องยิง
            </button>
            <button className={shot.target === TARGETS.point3 ? "choice active" : "choice"} onClick={() => onChange({ target: TARGETS.point3, results: [null, null] })}>
              จุดที่ 3
            </button>
          </ChoiceGrid>
        ) : null}

        {phase === "distance" ? (
          <ChoiceGrid columns={2}>
            <button className={shot.distancePassed === true ? "choice pass active" : "choice pass"} onClick={() => onChange({ distancePassed: true })}>ผ่าน 90 cm</button>
            <button className={shot.distancePassed === false ? "choice fail active" : "choice fail"} onClick={() => onChange({ distancePassed: false })}>ไม่ผ่าน</button>
          </ChoiceGrid>
        ) : null}

        {phase !== "distance" && shot.distancePassed === false ? <p className="danger">ไม่ผ่านระยะ ข้ามขั้นนี้ คะแนนรอบนี้ = 0</p> : null}

        {phase === "operation" && shot.distancePassed !== false ? (
          <>
            {index === 0 ? (
              <div className="smooth-grid">
                <h4>ความราบรื่น</h4>
                <Counter label="ใช้มือ" value={shot.handCount} onChange={(value) => onChange({ handCount: value })} />
                <Counter label="ชิ้นส่วนหล่น" value={shot.droppedPartsCount} onChange={(value) => onChange({ droppedPartsCount: value })} />
                <strong className={smooth === 20 ? "smooth-score ok" : "smooth-score danger"}>{smooth ?? "-"}/20</strong>
              </div>
            ) : null}

            <div className="sub-section compact-section">
              <h4>ยิงอัตโนมัติ</h4>
              <ChoiceGrid columns={2}>
                <button className={shot.autoLaunch === true ? "choice pass active" : "choice pass"} onClick={() => onChange({ autoLaunch: true })}>ออโต้ +2</button>
                <button className={shot.autoLaunch === false ? "choice neutral active" : "choice neutral"} onClick={() => onChange({ autoLaunch: false })}>ไม่ออโต้</button>
              </ChoiceGrid>
            </div>

            <div className="sub-section compact-section">
              <h4>สัมผัสก่อนเป้าหมาย</h4>
              <div className="ball-card-grid touch-grid">
                {[0, 1].map((ballIndex) => (
                  <BallTouchChoice key={ballIndex} ballIndex={ballIndex} shot={shot} onChange={onChange} />
                ))}
              </div>
            </div>
          </>
        ) : null}

        {phase === "score" && shot.distancePassed === false ? <p className="danger">ไม่ผ่านระยะ คะแนนรอบนี้ = 0</p> : null}
        {phase === "score" && shot.distancePassed !== false ? (
          <>
            {shot.target ? <p className="muted">{shot.target === TARGETS.launcher ? "เครื่องยิง: เลือก A/B/C หรือไม่ได้คะแนน" : "จุดที่ 3: เลือกเข้า 10 หรือไม่ได้คะแนน"}</p> : <p className="danger">กรุณาเลือกตำแหน่งลูกบอลก่อน</p>}
            <div className="ball-card-grid result-grid">
              {[0, 1].map((ballIndex) => (
                <BallResultChoice key={ballIndex} ballIndex={ballIndex} shot={shot} onChange={onChange} />
              ))}
            </div>
          </>
        ) : null}
      </section>

      <div className="step-note">
        {phase !== "distance" && shot.distancePassed === null ? <p className="muted">ขั้นนี้จะครบได้หลังเลือกระยะยิง</p> : null}
        {phase !== "position" && !shot.target ? <p className="muted">ขั้นนี้จะครบได้หลังเลือกตำแหน่งลูกบอล</p> : null}
      </div>
    </section>
  );
}

function BallTouchChoice({ ballIndex, shot, onChange }) {
  const touched = shot.touches?.[ballIndex];
  const setTouched = (value) => {
    const touches = [...(shot.touches || [false, false])];
    touches[ballIndex] = value;
    const results = [...(shot.results || [null, null])];
    results[ballIndex] = null;
    onChange({ touches, results });
  };

  return (
    <div className="ball-card">
      <strong>ลูกที่ {ballIndex + 1}</strong>
      <ChoiceGrid columns={2}>
        <button className={touched === false ? "choice pass active" : "choice pass"} onClick={() => setTouched(false)}>ไม่สัมผัส</button>
        <button className={touched === true ? "choice fail active" : "choice fail"} onClick={() => setTouched(true)}>สัมผัส</button>
      </ChoiceGrid>
    </div>
  );
}

function BallResultChoice({ ballIndex, shot, onChange }) {
  const touched = shot.touches?.[ballIndex] === true;
  const result = shot.results?.[ballIndex] ?? null;
  const options = shot.target === TARGETS.point3
    ? [
        { value: "", label: "ไม่ได้", points: 0 },
        { value: "score", label: "เข้า", points: 10 },
      ]
    : [
        { value: "", label: "ไม่ได้", points: 0 },
        { value: "A", label: "A", points: 5 },
        { value: "B", label: "B", points: 4 },
        { value: "C", label: "C", points: 3 },
      ];

  const setResult = (value) => {
    const results = [...(shot.results || [null, null])];
    results[ballIndex] = value;
    onChange({ results });
  };

  return (
    <div className={touched ? "ball-card disabled" : "ball-card"}>
      <strong>ลูกที่ {ballIndex + 1}</strong>
      <ChoiceGrid columns={shot.target === TARGETS.point3 ? 2 : 4}>
        {options.map((option) => (
          <button key={option.value} disabled={touched} className={result === option.value ? "choice active" : "choice"} onClick={() => setResult(option.value)}>
            <span>{option.label}</span>
            <small>{option.points} คะแนน</small>
          </button>
        ))}
      </ChoiceGrid>
    </div>
  );
}

function ChoiceGrid({ children, columns = 2 }) {
  return (
    <div className="choice-grid" style={{ "--choice-columns": columns }}>
      {children}
    </div>
  );
}

function Counter({ label, value, onChange }) {
  const selected = Number.isInteger(value);
  return (
    <div className="counter">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}>-</button>
      <strong>{selected ? value : "-"}</strong>
      <button onClick={() => onChange((value ?? 0) + 1)}>+</button>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
