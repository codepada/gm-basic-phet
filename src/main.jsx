import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LEVELS, LEVEL_LABELS, PK_POLICY, TARGETS } from "./core/constants.js";
import { mainScore, missionScore, pkScore, smoothnessScore } from "./core/scoring.js";
import { pkNeededForMain, rankGroupsByScore } from "./core/pk.js";
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
  target: TARGETS.launcher,
  distancePassed: true,
  handCount: withSmoothness ? 0 : undefined,
  droppedPartsCount: withSmoothness ? 0 : undefined,
  autoLaunch: false,
  touches: [false, false],
  results: ["", ""],
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
    return <ScoreWizard team={selectedTeam} existing={scores[selectedTeam.id]} role={role} onCancel={() => setSelectedTeam(null)} onSave={saveMainScore} />;
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

function ScoreWizard({ team, existing, role, onCancel, onSave }) {
  const [deviceCount, setDeviceCount] = useState(existing?.deviceCount ?? 0);
  const [shots, setShots] = useState(existing?.shots ?? [blankShot(true), blankShot(false), blankShot(false)]);
  const [reason, setReason] = useState("");
  const draft = { deviceCount, shots };
  const breakdown = mainScore(draft);

  const updateShot = (index, patch) => {
    setShots((current) => current.map((shot, shotIndex) => (shotIndex === index ? { ...shot, ...patch } : shot)));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{team.name}</p>
          <h1>ให้คะแนนรอบแรก</h1>
        </div>
        <button className="ghost" onClick={onCancel}>ปิด</button>
      </header>

      <section className="panel">
        <label>
          จำนวนอุปกรณ์ 0-5
          <input type="number" min="0" max="5" value={deviceCount} onChange={(event) => setDeviceCount(Number(event.target.value))} />
        </label>
      </section>

      {shots.map((shot, index) => (
        <ShotEditor key={index} index={index} shot={shot} onChange={(patch) => updateShot(index, patch)} />
      ))}

      {existing ? (
        <section className="panel">
          <label>
            เหตุผลการแก้คะแนน
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
        </section>
      ) : null}

      <section className="sticky-total">
        <div>
          <span>Total</span>
          <strong>{breakdown.total}</strong>
        </div>
        <button disabled={existing && !reason.trim()} onClick={() => onSave(team, draft, reason)}>บันทึกคะแนน</button>
      </section>
    </main>
  );
}

function ShotEditor({ index, shot, onChange }) {
  const mission = missionScore(shot);
  const smooth = index === 0 ? smoothnessScore(shot.handCount, shot.droppedPartsCount) : null;
  const resultOptions = shot.target === TARGETS.point3 ? ["", "score"] : ["", "A", "B", "C"];

  return (
    <section className="panel shot-panel">
      <h2>ยิงครั้งที่ {index + 1}</h2>
      <div className="segmented">
        <button className={shot.target === TARGETS.launcher ? "active" : ""} onClick={() => onChange({ target: TARGETS.launcher, results: ["", ""] })}>เครื่องยิง</button>
        <button className={shot.target === TARGETS.point3 ? "active" : ""} onClick={() => onChange({ target: TARGETS.point3, results: ["", ""] })}>จุด 3</button>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={shot.distancePassed} onChange={(event) => onChange({ distancePassed: event.target.checked })} />
        ระยะยิงผ่าน 90 cm ขึ้นไป
      </label>
      {shot.distancePassed ? (
        <>
          {index === 0 ? (
            <div className="smooth-grid">
              <Counter label="ใช้มือ" value={shot.handCount} onChange={(value) => onChange({ handCount: value })} />
              <Counter label="ชิ้นส่วนหล่น" value={shot.droppedPartsCount} onChange={(value) => onChange({ droppedPartsCount: value })} />
              <strong className={smooth === 20 ? "ok" : "danger"}>{smooth}/20</strong>
            </div>
          ) : null}
          <label className="check-row">
            <input type="checkbox" checked={shot.autoLaunch} onChange={(event) => onChange({ autoLaunch: event.target.checked })} />
            ยิงอัตโนมัติ +2
          </label>
          <div className="ball-table">
            {[0, 1].map((ballIndex) => (
              <div key={ballIndex}>
                <strong>ลูก {ballIndex + 1}</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={shot.touches?.[ballIndex] || false}
                    onChange={(event) => {
                      const touches = [...(shot.touches || [false, false])];
                      touches[ballIndex] = event.target.checked;
                      const results = [...(shot.results || ["", ""])];
                      if (event.target.checked) results[ballIndex] = "";
                      onChange({ touches, results });
                    }}
                  />
                  สัมผัสก่อนเป้าหมาย
                </label>
                <select
                  disabled={shot.touches?.[ballIndex]}
                  value={shot.results?.[ballIndex] || ""}
                  onChange={(event) => {
                    const results = [...(shot.results || ["", ""])];
                    results[ballIndex] = event.target.value;
                    onChange({ results });
                  }}
                >
                  {resultOptions.map((option) => (
                    <option key={option} value={option}>{option || "ไม่ได้คะแนน"}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </>
      ) : <p className="danger">ไม่ผ่านระยะ คะแนนรอบนี้ = 0</p>}
      <p className="score-line">Mission {mission} คะแนน</p>
    </section>
  );
}

function Counter({ label, value, onChange }) {
  return (
    <div className="counter">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(0, value - 1))}>-</button>
      <strong>{value}</strong>
      <button onClick={() => onChange(value + 1)}>+</button>
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
