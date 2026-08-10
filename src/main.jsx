import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LEVELS, LEVEL_LABELS, PK_POLICY, TARGETS } from "./core/constants.js";
import { mainScore, missionScore, smoothnessReady, smoothnessScore } from "./core/scoring.js";
import { pkNeededForMain } from "./core/pk.js";
import { sampleTeams } from "./data/sampleTeams.js";
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
  const [role, setRole] = useState("admin");
  const [levelId, setLevelId] = useState("sci01");
  const [teamsByLevel, setTeamsByLevel] = useState(initialTeams);
  const [scores, setScores] = useState({});
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [awardCutoff, setAwardCutoff] = useState(6);
  const [pkPolicy, setPkPolicy] = useState(PK_POLICY.podiumCutoff);
  const [auditLogs, setAuditLogs] = useState([]);

  const teams = teamsByLevel[levelId] || [];
  const enrichedTeams = teams.map((team) => ({
    ...team,
    mainTotal: scores[team.id]?.breakdown?.total ?? team.mainTotal,
    status: scores[team.id] ? "main-complete" : team.status,
  }));

  const saveMainScore = (team, draft, reason = "") => {
    const before = scores[team.id] || null;
    const breakdown = mainScore(draft);
    const after = {
      ...draft,
      teamId: team.id,
      levelId,
      breakdown,
      total: breakdown.total,
      completedShots: 3,
      updatedAt: new Date().toISOString(),
      updatedBy: role,
    };
    setScores((current) => ({ ...current, [team.id]: after }));
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
  };

  if (selectedTeam) {
    return <ScoreWizard team={selectedTeam} existing={scores[selectedTeam.id]} onCancel={() => setSelectedTeam(null)} onSave={saveMainScore} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Green Mech Scoring</p>
          <h1>{role === "admin" ? "Admin Dashboard" : `Judge ${role.toUpperCase()}`}</h1>
        </div>
        <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="role">
          <option value="admin">Admin</option>
          <option value="sci01">sci01</option>
          <option value="sci02">sci02</option>
          <option value="sci03">sci03</option>
        </select>
      </header>

      <LevelTabs levelId={levelId} setLevelId={setLevelId} />

      {role === "admin" ? (
        <AdminPage
          levelId={levelId}
          teams={enrichedTeams}
          scores={scores}
          auditLogs={auditLogs}
          awardCutoff={awardCutoff}
          setAwardCutoff={setAwardCutoff}
          pkPolicy={pkPolicy}
          setPkPolicy={setPkPolicy}
          setTeamsByLevel={setTeamsByLevel}
        />
      ) : (
        <JudgePage teams={enrichedTeams} scores={scores} onScore={setSelectedTeam} />
      )}
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

function AdminPage({ levelId, teams, scores, auditLogs, awardCutoff, setAwardCutoff, pkPolicy, setPkPolicy, setTeamsByLevel }) {
  const completed = teams.filter((team) => scores[team.id]);
  const mainRanking = [...teams].sort((a, b) => (b.mainTotal ?? -1) - (a.mainTotal ?? -1));
  const pkNeeds = completed.length === teams.length ? pkNeededForMain(completed, awardCutoff, pkPolicy) : [];

  const importText = (text) => {
    const names = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const unique = [...new Set(names)];
    if (unique.length !== names.length) {
      window.alert("มีชื่อซ้ำในไฟล์ import");
      return;
    }
    setTeamsByLevel((current) => ({
      ...current,
      [levelId]: unique.map((name, index) => ({ id: `${levelId}-import-${Date.now()}-${index}`, name, order: index + 1, status: "pending", mainTotal: null })),
    }));
  };

  return (
    <section className="stack">
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

      <ImportPanel onImport={importText} />

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

function ImportPanel({ onImport }) {
  const [text, setText] = useState("");
  const names = useMemo(() => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), [text]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

  return (
    <section className="panel">
      <h2>Import รายชื่อทีม</h2>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="1 บรรทัด = 1 ทีม" rows={6} />
      <p className={duplicates.length ? "danger" : "muted"}>Preview {names.length} ทีม{duplicates.length ? ` • ซ้ำ: ${[...new Set(duplicates)].join(", ")}` : ""}</p>
      <button disabled={!names.length || duplicates.length > 0} onClick={() => onImport(text)}>บันทึกรายชื่อ</button>
    </section>
  );
}

function ScoreWizard({ team, existing, onCancel, onSave }) {
  const [deviceCount, setDeviceCount] = useState(existing?.deviceCount ?? null);
  const [shots, setShots] = useState(existing?.shots ?? [blankShot(true), blankShot(false), blankShot(false)]);
  const [reason, setReason] = useState("");
  const [step, setStep] = useState(0);
  const draft = { deviceCount, shots };
  const breakdown = mainScore(draft);
  const steps = buildWizardSteps();
  const activeStep = steps[step];
  const isLastStep = step === steps.length - 1;
  const currentStepReady = wizardStepReady(activeStep, deviceCount, shots);
  const allShotsReady = Number.isInteger(deviceCount) && shots.every((shot, index) => shotReady(shot, index));
  const firstIncompleteStep = findFirstIncompleteStep(steps, deviceCount, shots);
  const reasonMissing = Boolean(existing && !reason.trim());
  const saveDisabled = !allShotsReady || reasonMissing;

  const updateShot = (index, patch) => {
    setShots((current) => current.map((shot, shotIndex) => (shotIndex === index ? { ...shot, ...patch } : shot)));
  };

  return (
    <main className="app-shell wizard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{team.name}</p>
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
            <button disabled={saveDisabled} onClick={() => onSave(team, draft, reason)}>บันทึกคะแนน</button>
          ) : (
            <button disabled={!currentStepReady} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>ถัดไป</button>
          )}
          {isLastStep && saveDisabled ? (
            <span className="save-hint">{reasonMissing ? "ใส่เหตุผลการแก้คะแนนก่อน" : `ยังไม่ครบ: ${firstIncompleteStep?.step.title}`}</span>
          ) : null}
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
  const shot = shots[step.shotIndex];
  if (step.phase === "position") return shot?.target === TARGETS.launcher || shot?.target === TARGETS.point3;
  if (step.phase === "distance") return shot?.distancePassed === true || shot?.distancePassed === false;
  if (step.phase === "operation") return operationReady(shot, step.shotIndex);
  if (step.phase === "score") return scoreReady(shot);
  return false;
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
    <section className="panel scoring-step">
      <div>
        <p className="eyebrow">ก่อนยิง</p>
        <h2>จำนวนอุปกรณ์</h2>
      </div>
      <p className="muted">เลือกจำนวนอุปกรณ์ที่ใช้ คะแนนสูงสุด 5</p>
      <ChoiceGrid columns={6}>
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
    <section className="panel scoring-step">
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
              <span>ยิงครั้งที่ {index + 1} • {shot.target === TARGETS.launcher ? "เครื่องยิง" : shot.target === TARGETS.point3 ? "จุดที่ 3" : "ยังไม่เลือก"}</span>
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
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="จำเป็นเมื่อแก้คะแนน" />
          {!reason.trim() ? <span className="danger">ต้องใส่เหตุผลก่อนบันทึกการแก้คะแนน</span> : null}
        </label>
      ) : null}
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
    <section className="panel shot-panel scoring-step">
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
              {[0, 1].map((ballIndex) => (
                <BallTouchChoice key={ballIndex} ballIndex={ballIndex} shot={shot} onChange={onChange} />
              ))}
            </div>
          </>
        ) : null}

        {phase === "score" && shot.distancePassed === false ? <p className="danger">ไม่ผ่านระยะ คะแนนรอบนี้ = 0</p> : null}
        {phase === "score" && shot.distancePassed !== false ? (
          <>
            {shot.target ? <p className="muted">{shot.target === TARGETS.launcher ? "เครื่องยิง: เลือก A/B/C หรือไม่ได้คะแนน" : "จุดที่ 3: เลือกเข้า 10 หรือไม่ได้คะแนน"}</p> : <p className="danger">กรุณาเลือกตำแหน่งลูกบอลก่อน</p>}
            {[0, 1].map((ballIndex) => (
              <BallResultChoice key={ballIndex} ballIndex={ballIndex} shot={shot} onChange={onChange} />
            ))}
          </>
        ) : null}
      </section>

      {phase !== "distance" && shot.distancePassed === null ? <p className="muted">ขั้นนี้จะครบได้หลังเลือกระยะยิง</p> : null}
      {phase !== "position" && !shot.target ? <p className="muted">ขั้นนี้จะครบได้หลังเลือกตำแหน่งลูกบอล</p> : null}
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
