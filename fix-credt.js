const fs = require("node:fs");
let c = fs.readFileSync(
  "src/features/credentials/components/credential.tsx",
  "utf8",
);
c = c.replace(
  /const credentialTypeOptions = \[\s*\{[\s\S]*?\];/g,
  'const credentialTypeOptions = [{ value: CredentialType.WHATSAPP_TOKEN, label: "WhatsApp", logo: "/logos/whatsapp.svg", valueLabel: "Token", valuePlaceholder: "EAAX..." }];',
);
c = c.replace(/CredentialType\.OPENAI/g, "CredentialType.WHATSAPP_TOKEN");
fs.writeFileSync("src/features/credentials/components/credential.tsx", c);
