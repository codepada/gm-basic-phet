/* global process, fetch */

const apiKey = process.env.VITE_FIREBASE_API_KEY;
const adminPassword = process.env.FIREBASE_ADMIN_PASSWORD;
const judgePassword = process.env.FIREBASE_JUDGE_PASSWORD;
const authEmailDomain = process.env.AUTH_EMAIL_DOMAIN || "gm-basic-phet.local";

if (!apiKey) throw new Error("Missing VITE_FIREBASE_API_KEY");
if (!adminPassword) throw new Error("Missing FIREBASE_ADMIN_PASSWORD");
if (!judgePassword) throw new Error("Missing FIREBASE_JUDGE_PASSWORD");

const judgeIds = ["el", "jh", "sh"].flatMap((level) => Array.from({ length: 10 }, (_, index) => `${level}${String(index + 1).padStart(2, "0")}`));
const accounts = [
  { id: "admin", password: adminPassword },
  ...judgeIds.map((id) => ({ id, password: judgePassword })),
];

async function createAccount({ id, password }) {
  const email = `${id}@${authEmailDomain}`;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const result = await response.json();
  if (response.ok) {
    console.log(`created ${id}`);
    return;
  }
  if (result?.error?.message === "EMAIL_EXISTS") {
    console.log(`exists ${id}`);
    return;
  }
  throw new Error(`${id}: ${result?.error?.message || "create failed"}`);
}

for (const account of accounts) {
  await createAccount(account);
}
