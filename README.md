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

For online testing before the login system is finished:

1. Enable Firebase Authentication > Sign-in method > Anonymous.
2. Add these GitHub repository secrets:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_TOKEN` for manually deploying Firestore rules
3. Optional GitHub repository variable:
   - `VITE_COMPETITION_ID` defaults to `green-mech-2026`
4. For Firebase Hosting, push to `main`; the site deploys from `.github/workflows/firebase-hosting.yml`.
5. For GitHub Pages, the repo or GitHub plan must support Pages. Enable Pages with source `GitHub Actions`; the workflow is `.github/workflows/pages.yml`.

The temporary Firestore rules allow signed-in anonymous users to read/write for testing. Lock these rules before real competition use.

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
