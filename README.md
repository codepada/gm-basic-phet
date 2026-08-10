# GM Basic Phet - Green Mech Scoring

Mobile-first scoring app for Green Mech judges and admins.

## Roles

- `sci01` ประถมศึกษา
- `sci02` มัธยมศึกษาตอนต้น
- `sci03` มัธยมศึกษาตอนปลาย
- `admin` ผู้ดูแลระบบ

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Firebase

Create a Firebase project, enable Authentication, Cloud Firestore, Storage, and Hosting. Put browser config values in `.env.local`; never commit secrets or service accounts.

Deploy:

```bash
npm run build
firebase deploy
```

## Data Model

```text
competitions/{competitionId}
  levels/{sci01|sci02|sci03}
    teams/{teamId}
    mainScores/{teamId}
    pkSessions/{sessionId}
    pkAttempts/{attemptId}
    auditLogs/{auditId}
  users/{uid}
  settings/main
```

Backups are JSON files in Firebase Storage:

```text
backups/YYYY-MM-DD/competition-backup-HH-mm-ss.json
```

## Status

This scaffold includes:

- scoring formulas and tests
- PK policy engine
- mobile-first Admin/Judge UI prototype
- Firestore paths/services with transaction-oriented writes
- Firebase rules/indexes placeholders
- GitHub Actions CI
