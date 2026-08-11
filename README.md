# GM Basic Phet - Green Mech Scoring

Mobile-first scoring app for Green Mech judges and admins.

## Roles

- `el01`-`el10` ประถมศึกษา
- `jh01`-`jh10` มัธยมศึกษาตอนต้น
- `sh01`-`sh10` มัธยมศึกษาตอนปลาย
- `admin` ผู้ดูแลระบบ

Login is checked by Firebase Auth. Judges still type the short ID, such as `sh01`; the app maps it to a Firebase Auth email internally.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Firebase

Create a Firebase project, enable Cloud Firestore, Firebase Auth Email/Password, Storage, and Hosting. Put browser config values in `.env.local`; never commit service accounts or passwords.

Add these GitHub repository secrets:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `FIREBASE_PROJECT_ID`
Optional GitHub repository variable:
   - `VITE_COMPETITION_ID` defaults to `green-mech-2026`

Add these GitHub repository secrets for seeding Firebase Auth users:
   - `FIREBASE_ADMIN_PASSWORD`
   - `FIREBASE_JUDGE_PASSWORD`

Run the `Seed Firebase Auth Users` workflow after setting those secrets. It creates:
   - `admin@gm-basic-phet.local`
   - `el01`-`el10` as Firebase Auth emails
   - `jh01`-`jh10` as Firebase Auth emails
   - `sh01`-`sh10` as Firebase Auth emails

The deployed GitHub Pages site uses Firestore as the shared score database.

Deploy:

```bash
npm run build
firebase deploy
```

## Data Model

```text
competitions/{competitionId}
  levels/{el|jh|sh}
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
