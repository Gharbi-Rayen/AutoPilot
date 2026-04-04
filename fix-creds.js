const fs = require("node:fs");

const invalidCreds = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "DISCORD_WEBHOOK",
  "SLACK_WEBHOOK",
  "TELEGRAM_BOT",
  "EMAIL_SMTP",
];

// Fix credential-picker.tsx
const file1 = "src/features/credentials/components/credential-picker.tsx";
let c1 = fs.readFileSync(file1, "utf8");
const p1Filter = new RegExp(
  `\\[CredentialType\\.(${invalidCreds.join("|")})\\]:\\s*\\{[^}]+\\},?\\s*`,
  "g",
);
c1 = c1.replace(p1Filter, "");
fs.writeFileSync(file1, c1);

// Fix credential.tsx
const file2 = "src/features/credentials/components/credential.tsx";
let c2 = fs.readFileSync(file2, "utf8");
const p2Filter = new RegExp(
  `\\{\\s*label:\\s*"[^"]+",\\s*value:\\s*CredentialType\\.(${invalidCreds.join("|")}),\\s*\\},?\\s*`,
  "g",
);
c2 = c2.replace(p2Filter, "");
c2 = c2.replace(/CredentialType\.OPENAI/g, "CredentialType.WHATSAPP_TOKEN");
fs.writeFileSync(file2, c2);

// Fix credentials.tsx
const file3 = "src/features/credentials/components/credentials.tsx";
let c3 = fs.readFileSync(file3, "utf8");
const p3Filter = new RegExp(
  `\\[CredentialType\\.(${invalidCreds.join("|")})\\]\\s*:\\s*"[^"]+",?\\s*`,
  "g",
);
c3 = c3.replace(p3Filter, "");
fs.writeFileSync(file3, c3);
