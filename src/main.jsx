import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { signInAnonymously } from "firebase/auth";
import { LEVELS, LEVEL_LABELS, PK_POLICY, TARGETS } from "./core/constants.js";
import { mainScore, missionScore, smoothnessReady, smoothnessScore } from "./core/scoring.js";
import { pkNeededForMain } from "./core/pk.js";
import { nextUnscoredTeam } from "./core/teams.js";
import { sampleTeams } from "./data/sampleTeams.js";
import { auth, isFirebaseConfigured } from "./firebase/config.js";
import { listenMainScores, listenTeams, saveTeamSetup, submitMainScore } from "./firebase/services.js";
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
};

const LOGIN_IDS = ["admin", "sci01", "sci02", "sci03"];
const TEST_PASSWORD = "1234";

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

const blankShot = (withSmoothness = false) => ({
  target: null,
  distancePassed: null,
  handCount: withSmoothness ? 0 : undefined,
  droppedPartsCount: withSmoothness ? 0 : undefined,
  autoLaunch: null,
  touches: [null, null],
  results: [null, null],
});

function App() {
  const [session, setSession] = useState(() => readStoredValue(STORAGE_KEYS.session, null));
  const [role, setRole] = useState(session?.role || "");
  const [levelId, setLevelId] = useState(session?.role && session.role !== "admin" ? session.role : "sci01");
  const [teamsByLevel, setTeamsByLevel] = useState(() => readStoredValue(STORAGE_KEYS.teams, initialTeams));
  const [scores, setScores] = useState(() => readStoredValue(STORAGE_KEYS.scores, {}));
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [awardCutoff, setAwardCutoff] = useState(6);
  const [pkPolicy, setPkPolicy] = useState(PK_POLICY.podiumCutoff);
  const [auditLogs, setAuditLogs] = useState(() => readStoredValue(STORAGE_KEYS.auditLogs, []));
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState(isFirebaseConfigured ? "กำลังต่อ Firebase..." : "โหมดทดสอบในเครื่อง");
  const [syncError, setSyncError] = useState("");
  const [setupStatus, setSetupStatus] = useState("");

  const teams = teamsByLevel[levelId] || [];
  const enrichedTeams = teams.map((team) => ({
    ...team,
    mainTotal: scores[team.id]?.breakdown?.total ?? team.mainTotal,
    status: scores[team.id] ? "main-complete" : team.status,
  }));

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
    if (session) writeStoredValue(STORAGE_KEYS.session, session);
    else window.localStorage.removeItem(STORAGE_KEYS.session);
  }, [session]);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    let active = true;
    signInAnonymously(auth)
      .then((credential) => {
        if (!active) return;
        setFirebaseUser(credential.user);
        setSyncStatus("ต่อ Firebase แล้ว");
        setSyncError("");
      })
      .catch((error) => {
        if (!active) return;
        setSyncStatus("Firebase ต่อไม่ได้");
        setSyncError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseUser) return undefined;
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
  }, [firebaseUser, levelId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseUser) return undefined;
    const unsubscribe = listenMainScores(
      levelId,
      (remoteScores) => {
        setScores((current) => {
          const next = { ...current };
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
  }, [firebaseUser, levelId]);

  const saveMainScore = async (team, draft, reason = "") => {
    const before = scores[team.id] || null;
    const breakdown = mainScore(draft);
    const after = {
      ...draft,
      teamName: team.name,
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
    const currentTeams = teamsByLevel[levelId] || [];
    const nextTeam = nextUnscoredTeam(currentTeams, nextScores, team.id);

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
        team: team.name,
        action: before ? "mainScore.update" : "mainScore.create",
        before,
        after,
        reason,
      },
      ...current,
    ]);
    setSelectedTeam(null);
    setSaveResult({ savedTeam: team, nextTeam: nextTeam ? { ...nextTeam } : null, total: breakdown.total });

    if (isFirebaseConfigured && firebaseUser) {
      setSyncStatus("กำลัง sync Firebase...");
      setSyncError("");
      try {
        await submitMainScore(levelId, team.id, after, firebaseUser, reason);
        setSyncStatus("sync Firebase สำเร็จ");
      } catch (error) {
        setSyncStatus("บันทึกในเครื่องแล้ว แต่ sync Firebase ไม่สำเร็จ");
        setSyncError(error.message);
      }
    }
  };

  const saveTeamsFromAdmin = async (names) => {
    const cleanNames = names.map((name) => name.trim());
    const filledNames = cleanNames.filter(Boolean);
    const duplicates = filledNames.filter((name, index) => filledNames.indexOf(name) !== index);
    if (filledNames.length !== cleanNames.length) throw new Error("ยังมีชื่อทีมว่าง");
    if (duplicates.length) throw new Error(`ชื่อทีมซ้ำ: ${[...new Set(duplicates)].join(", ")}`);

    const currentLevelTeams = teamsByLevel[levelId] || [];
    const currentIds = new Set(currentLevelTeams.map((team) => team.id));
    const nextTeams = filledNames.map((name, index) => {
      const id = `${levelId}-${index + 1}`;
      const score = scores[id];
      return {
        id,
        name,
        order: index + 1,
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

    if (isFirebaseConfigured && firebaseUser) {
      setSyncStatus("กำลัง sync รายชื่อทีม...");
      setSyncError("");
      try {
        await saveTeamSetup(levelId, nextTeams, firebaseUser);
        setSyncStatus("sync รายชื่อทีมสำเร็จ");
        setSetupStatus("บันทึกและ sync รายชื่อทีมสำเร็จ");
      } catch (error) {
        setSyncStatus("บันทึกรายชื่อในเครื่องแล้ว แต่ sync Firebase ไม่สำเร็จ");
        setSyncError(error.message);
        throw error;
      }
    }
  };

  const handleLogin = ({ id, password }) => {
    if (password !== TEST_PASSWORD) throw new Error("รหัสไม่ถูกต้อง");
    setSession({ role: id, at: new Date().toISOString() });
    setRole(id);
    if (id !== "admin") setLevelId(id);
    setSelectedTeam(null);
    setSaveResult(null);
  };

  const handleLogout = () => {
    setSession(null);
    setRole("");
    setSelectedTeam(null);
    setSaveResult(null);
  };

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (saveResult) {
    return (
      <SaveCompletePage
        result={saveResult}
        onNext={() => {
          setSelectedTeam(saveResult.nextTeam);
          setSaveResult(null);
        }}
        onList={() => setSaveResult(null)}
      />
    );
  }

  if (selectedTeam) {
    return <ScoreWizard key={selectedTeam.id} team={selectedTeam} existing={scores[selectedTeam.id]} onCancel={() => setSelectedTeam(null)} onSave={saveMainScore} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Green Mech Scoring</p>
          <h1>{role === "admin" ? "Admin Dashboard" : `Judge ${role.toUpperCase()}`}</h1>
        </div>
        <button className="ghost topbar-logout" onClick={handleLogout}>ออก</button>
      </header>
      <SyncBanner status={syncStatus} error={syncError} />

      {role === "admin" ? <LevelTabs levelId={levelId} setLevelId={setLevelId} /> : null}

      {role === "admin" ? (
        <AdminPage
          levelId={levelId}
          teams={enrichedTeams}
          scores={scores}
          auditLogs={auditLogs}
          isCloudReady={isFirebaseConfigured && syncStatus === "ต่อ Firebase แล้ว"}
          syncStatus={syncStatus}
          setupStatus={setupStatus}
          awardCutoff={awardCutoff}
          setAwardCutoff={setAwardCutoff}
          pkPolicy={pkPolicy}
          setPkPolicy={setPkPolicy}
          onSaveTeamSetup={saveTeamsFromAdmin}
        />
      ) : (
        <JudgePage teams={enrichedTeams} scores={scores} onScore={setSelectedTeam} />
      )}
    </main>
  );
}

function LoginPage({ onLogin }) {
  const [id, setId] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");
    try {
      onLogin({ id, password });
    } catch (loginError) {
      setError(loginError.message || "เข้าสู่ระบบไม่สำเร็จ");
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
            placeholder="1234"
          />
        </label>

        {error ? <p className="danger login-error">{error}</p> : null}
        <button type="submit">เข้าสู่ระบบ</button>
      </form>
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

function SaveCompletePage({ result, onNext, onList }) {
  return (
    <main className="app-shell save-complete-shell">
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
          {level.id}
        </button>
      ))}
    </nav>
  );
}

function JudgePage({ teams, scores, onScore }) {
  return (
    <section className="stack">
      <div className="summary-row">
        <Metric label="ทีมทั้งหมด" value={teams.length} />
        <Metric label="จบแล้ว" value={teams.filter((team) => team.status === "main-complete").length} />
        <Metric label="ยังไม่จบ" value={teams.filter((team) => team.status !== "main-complete").length} />
      </div>
      <div className="team-list">
        {teams.map((team) => (
          <article key={team.id} className="team-row">
            <div className="team-order">{team.order}</div>
            <div className="team-main">
              <strong>{team.name}</strong>
              <span>{scores[team.id] ? `ตรวจแล้ว • ยิงครบ 3 ครั้ง • ${scores[team.id].total} คะแนน` : "รอให้คะแนน"}</span>
            </div>
            <button onClick={() => onScore(team)}>{scores[team.id] ? "แก้คะแนน" : "เริ่มให้คะแนน"}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminPage({ levelId, teams, scores, auditLogs, isCloudReady, syncStatus, setupStatus, awardCutoff, setAwardCutoff, pkPolicy, setPkPolicy, onSaveTeamSetup }) {
  const completed = teams.filter((team) => scores[team.id]);
  const mainRanking = [...teams].sort((a, b) => (b.mainTotal ?? -1) - (a.mainTotal ?? -1));
  const pkNeeds = completed.length === teams.length ? pkNeededForMain(completed, awardCutoff, pkPolicy) : [];

  return (
    <section className="stack">
      {!isCloudReady ? (
        <section className="panel cloud-warning">
          <strong>Admin จะเห็นคะแนนข้ามเครื่องเมื่อ Firebase พร้อมเท่านั้น</strong>
          <span>สถานะตอนนี้: {syncStatus} คะแนนที่กรรมการบันทึกจากมือถืออื่นจะยังไม่มาแสดงในหน้า Admin จนกว่าจะตั้งค่า Firebase บน GitHub Pages</span>
        </section>
      ) : null}

      <div className="summary-row">
        <Metric label="ทีม" value={teams.length} />
        <Metric label="จบรอบแรก" value={completed.length} />
        <Metric label="ยังไม่จบ" value={teams.length - completed.length} />
      </div>

      <section className="panel">
        <h2>ตั้งค่า PK</h2>
        <div className="form-grid">
          <label>
            ให้รางวัลถึงอันดับที่
            <select value={awardCutoff} onChange={(event) => setAwardCutoff(Number(event.target.value))}>
              {Array.from({ length: 18 }, (_, index) => index + 3).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={pkPolicy} onChange={(event) => setPkPolicy(event.target.value)}>
              <option value={PK_POLICY.podiumCutoff}>Podium + Award Cutoff</option>
              <option value={PK_POLICY.exactRanking}>Exact Ranking 1-N</option>
            </select>
          </label>
        </div>
      </section>

      <TeamSetupPanel levelId={levelId} teams={teams} status={setupStatus} onSave={onSaveTeamSetup} />

      <section className="panel">
        <h2>{LEVEL_LABELS[levelId]} Main Summary</h2>
        {completed.length !== teams.length ? <p className="muted">ยังไม่ครบทุกทีม ห้ามเริ่ม PK</p> : <p className="ok">ครบแล้ว ครูกดเริ่ม PK ได้</p>}
        <div className="ranking">
          {mainRanking.map((team, index) => (
            <div key={team.id}>
              <span>{index + 1}. {team.name}</span>
              <strong>{team.mainTotal ?? "-"} คะแนน</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>PK Status</h2>
        {completed.length !== teams.length ? (
          <p className="muted">ยังไม่สรุป</p>
        ) : pkNeeds.length ? (
          pkNeeds.map((need) => (
            <div key={need.teamIds.join("-")} className="pk-card">
              <strong>ต้อง PK ชิงอันดับ {need.placeStart}-{need.placeEnd}</strong>
              <span>{need.teamIds.length} ทีม • Main {need.score}</span>
              <button>เริ่ม PK</button>
            </div>
          ))
        ) : (
          <p className="ok">ไม่ต้อง PK ตาม policy ปัจจุบัน</p>
        )}
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
    </section>
  );
}

function TeamSetupPanel({ levelId, teams, status, onSave }) {
  const [count, setCount] = useState(teams.length);
  const [names, setNames] = useState(() => teams.map((team) => team.name));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCount(teams.length);
    setNames(teams.map((team) => team.name));
  }, [levelId, teams]);

  const duplicates = useMemo(() => names.filter((name, index) => name.trim() && names.findIndex((item) => item.trim() === name.trim()) !== index), [names]);
  const hasBlank = names.some((name) => !name.trim());

  const updateCount = (nextCount) => {
    setCount(nextCount);
    setNames((current) => Array.from({ length: nextCount }, (_, index) => current[index] || `ทีม ${index + 1}`));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      await onSave(names);
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

      <div className="team-name-grid">
        {names.map((name, index) => (
          <label key={`${levelId}-${index + 1}`}>
            ทีมที่ {index + 1}
            <input value={name} onChange={(event) => setNames((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))} />
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

function ScoreWizard({ team, existing, onCancel, onSave }) {
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
    <main className="app-shell wizard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow team-heading">{team.name}</p>
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
