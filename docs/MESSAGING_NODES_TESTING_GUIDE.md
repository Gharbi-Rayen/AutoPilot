# Messaging Nodes Testing Guide

Testing guide for **Discord**, **Slack**, **Telegram**, and **Email (SMTP)** nodes.

## Prerequisites

Before testing, make sure you have:

- [ ] Next.js dev server running (`npm run dev`)
- [ ] Inngest dev server running (`npx inngest-cli@latest dev`)
- [ ] Database migration applied (`npx prisma migrate deploy`) — if Neon DB was sleeping, wake it first
- [ ] Credentials set up for each service you want to test (see Setup sections below)

---

## Quick Start: Development Environment

```bash
# Terminal 1: Next.js dev server
npm run dev

# Terminal 2: Inngest dev server
npx inngest-cli@latest dev
```

Open the app at `http://localhost:3000` and the Inngest dashboard at `http://localhost:8288`.

---

## 1. Discord Node

### 1.1 Setup: Create a Discord Webhook

1. Open Discord → go to a server you own/manage
2. Right-click a text channel → **Edit Channel** → **Integrations** → **Webhooks**
3. Click **New Webhook**
4. Give it a name (e.g., "AutoPilot Bot")
5. Click **Copy Webhook URL**
6. The URL looks like: `https://discord.com/api/webhooks/123456789/abcdef...`

### 1.2 Add Credential in AutoPilot

1. Open AutoPilot → go to any workflow editor
2. Add a **Discord** node from the node selector
3. Click the node to open settings
4. In the **Discord Webhook** credential picker, click **+ Add Credential**
5. Paste your webhook URL as the credential value
6. Save the credential

### 1.3 Configure the Discord Node

| Field             | Test Value                                      |
| ----------------- | ----------------------------------------------- |
| Credential        | (select the webhook you just saved)             |
| Variable Name     | `discordResult`                                 |
| Message Content   | `Hello from AutoPilot! 🚀 Test at {{Date.now}}` |
| Username Override | `AutoPilot Bot` (optional)                      |
| Avatar URL        | (leave empty or paste any image URL)            |

### 1.4 Test Cases

**Test 1: Basic Message Send**

1. Create workflow: Manual Trigger → Discord node
2. Configure the Discord node as above
3. Save workflow → click **Run**
4. ✅ Expected: Message appears in your Discord channel
5. Check Inngest dashboard → Discord step should show `success: true`

**Test 2: Character Limit (2000 chars)**

1. Paste a message longer than 2000 characters
2. The char counter in the dialog should show red when over limit
3. Run the workflow
4. ✅ Expected: Message is truncated to 2000 chars with `[truncated]` suffix

**Test 3: Variable Interpolation**

1. Chain: Manual Trigger → HTTP Request (fetch `https://jsonplaceholder.typicode.com/users/1`) → Discord
2. Set Discord message to: `User: {{httpResult.name}} - Email: {{httpResult.email}}`
3. Run workflow
4. ✅ Expected: Discord message shows "User: Leanne Graham - Email: Sincere@april.biz"

**Test 4: Invalid Webhook URL**

1. Create a credential with `https://discord.com/api/webhooks/invalid/url`
2. Run the workflow
3. ✅ Expected: Node shows error status, Inngest shows error details

### 1.5 Verify Result Object

In Inngest step output, check the standardized result:

```json
{
  "success": true,
  "messageId": "1234567890",
  "timestamp": "2025-03-05T12:00:00.000Z",
  "provider": "discord"
}
```

---

## 2. Slack Node

### 2.1 Setup: Create a Slack Incoming Webhook

1. Go to [Slack API: Incoming Webhooks](https://api.slack.com/messaging/webhooks)
2. Create a new Slack app (or use an existing one)
3. Enable **Incoming Webhooks** → click **Add New Webhook to Workspace**
4. Select the channel → **Allow**
5. Copy the webhook URL: `https://hooks.slack.com/services/T.../B.../xxx`

> **Note:** Slack free plan allows max 10 app integrations.

### 2.2 Add Credential in AutoPilot

1. Add a **Slack** node to your workflow
2. In the **Slack Webhook** credential picker, click **+ Add Credential**
3. Paste your Slack webhook URL
4. Save

### 2.3 Configure the Slack Node

| Field         | Test Value                                           |
| ------------- | ---------------------------------------------------- |
| Credential    | (select the webhook you just saved)                  |
| Variable Name | `slackResult`                                        |
| Message Text  | `*Hello from AutoPilot!* 🚀\nThis is a test message` |

### 2.4 Test Cases

**Test 1: Basic Message Send**

1. Create workflow: Manual Trigger → Slack node
2. Configure as above
3. Save → Run
4. ✅ Expected: Message appears in your Slack channel with bold formatting

**Test 2: Slack mrkdwn Formatting**

1. Set message to:
   ```
   *Bold text* and _italic text_
   • Bullet point 1
   • Bullet point 2
   <https://example.com|Click here>
   ```
2. Run workflow
3. ✅ Expected: Slack renders bold, italic, bullets, and hyperlink correctly

**Test 3: Variable Interpolation**

1. Chain: Manual Trigger → HTTP Request → Slack
2. Set Slack message to: `New user registered: *{{httpResult.name}}* ({{httpResult.email}})`
3. Run
4. ✅ Expected: Message shows interpolated user data with bold name

**Test 4: Invalid Webhook**

1. Use a revoked or invalid webhook URL
2. Run
3. ✅ Expected: Error status on node, "Slack API returned unexpected response" in Inngest

### 2.5 Verify Result Object

```json
{
  "success": true,
  "timestamp": "2025-03-05T12:00:00.000Z",
  "provider": "slack"
}
```

> Note: Slack webhooks don't return a message ID.

---

## 3. Telegram Node

### 3.1 Setup: Create a Telegram Bot

1. Open Telegram → search for **@BotFather**
2. Send `/newbot` → follow the prompts to name your bot
3. BotFather will give you a **Bot Token**: `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`
4. **Save this token** — it's your credential

### 3.2 Get Your Chat ID

To send messages, you need the **Chat ID** of the target chat:

**Method A — @userinfobot:**

1. Search for `@userinfobot` in Telegram
2. Send it any message
3. It replies with your user ID (e.g., `123456789`)

**Method B — @RawDataBot:**

1. Add `@RawDataBot` to your group
2. It will print the chat info including the chat ID
3. Group IDs are negative (e.g., `-1001234567890`)
4. Remove the bot after getting the ID

**Method C — API call:**

1. Send a message to your bot in Telegram
2. Open: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat": { "id": 123456789 }` in the response

### 3.3 Add Credential in AutoPilot

1. Add a **Telegram** node
2. In the **Telegram Bot** credential picker, click **+ Add Credential**
3. Paste your bot token
4. Save

### 3.4 Configure the Telegram Node

| Field         | Test Value                        |
| ------------- | --------------------------------- |
| Credential    | (select bot token credential)     |
| Variable Name | `telegramResult`                  |
| Chat ID       | Your chat ID from step 3.2        |
| Parse Mode    | `HTML` (or `None` for plain text) |
| Message Text  | `<b>Hello</b> from AutoPilot! 🚀` |

### 3.5 Test Cases

**Test 1: Basic Message Send**

1. Create workflow: Manual Trigger → Telegram node
2. Configure as above
3. Save → Run
4. ✅ Expected: Message appears in your Telegram chat with bold "Hello"

**Test 2: Parse Modes**

| Parse Mode | Test Message                    | Expected              |
| ---------- | ------------------------------- | --------------------- |
| None       | `Hello *world*`                 | Literal `*world*`     |
| HTML       | `<b>Bold</b> and <i>italic</i>` | **Bold** and _italic_ |
| MarkdownV2 | `*Bold* and _italic_`           | **Bold** and _italic_ |

**Test 3: Character Limit (4096 chars)**

1. Paste a message longer than 4096 characters
2. Char counter should show red
3. Run
4. ✅ Expected: Message truncated with `[truncated]` suffix

**Test 4: Group Chat**

1. Add your bot to a Telegram group
2. Get the group chat ID (negative number)
3. Set Chat ID to the group ID
4. Run
5. ✅ Expected: Bot sends message to the group

**Test 5: Variable Interpolation with Chat ID**

1. Set Chat ID to `{{previousStep.chatId}}` (from a dynamic source)
2. Set message to `Report: {{httpResult.name}}`
3. ✅ Expected: Both chat ID and message text are interpolated

**Test 6: Invalid Bot Token**

1. Use `000000:invalid_token`
2. Run
3. ✅ Expected: Error with Telegram API error message

### 3.6 Verify Result Object

```json
{
  "success": true,
  "messageId": "42",
  "chatId": "123456789",
  "timestamp": "2025-03-05T12:00:00.000Z",
  "provider": "telegram"
}
```

---

## 4. Email (SMTP) Node

### 4.1 Setup: Gmail App Password (Recommended for Testing)

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (required)
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Select **Mail** → Generate
5. Copy the 16-character app password (e.g., `abcd efgh ijkl mnop`)
6. This is your credential — store it without spaces: `abcdefghijklmnop`

> **Gmail Free Limits:** 500 emails/day. Google Workspace: 2,000/day.

### 4.2 Setup: Alternative SMTP Services

| Service     | Host                | Port | Secure | Notes                          |
| ----------- | ------------------- | ---- | ------ | ------------------------------ |
| Gmail       | smtp.gmail.com      | 587  | No     | Use App Password               |
| Outlook 365 | smtp.office365.com  | 587  | No     | Use account password           |
| Yahoo       | smtp.mail.yahoo.com | 465  | Yes    | Generate App Password          |
| SendGrid    | smtp.sendgrid.net   | 587  | No     | Use API key as password        |
| Zoho        | smtp.zoho.com       | 465  | Yes    | Use account password           |
| Custom      | (your SMTP server)  | —    | —      | Fill in Host/Port/TLS manually |

### 4.3 Add Credential in AutoPilot

1. Add an **Email (SMTP)** node
2. In the **Email SMTP** credential picker, click **+ Add Credential**
3. Paste your SMTP password / app password
4. Save

### 4.4 Configure the Email Node

| Field         | Test Value                                       |
| ------------- | ------------------------------------------------ |
| Credential    | (select saved SMTP password)                     |
| SMTP Service  | `Gmail`                                          |
| Variable Name | `emailResult`                                    |
| From Email    | `your-email@gmail.com`                           |
| To Email      | `recipient@example.com`                          |
| Subject       | `Test from AutoPilot`                            |
| Body          | `Hello! This is a test email from AutoPilot. 🚀` |
| HTML Format   | Off (for plain text test)                        |

### 4.5 Test Cases

**Test 1: Basic Plain Text Email**

1. Create workflow: Manual Trigger → Email node
2. Configure as above (HTML Format OFF)
3. Save → Run
4. ✅ Expected: Email arrives in recipient's inbox
5. Check Inngest → step output shows `success: true` with `messageId`

**Test 2: HTML Email**

1. Toggle **HTML Format** ON
2. Set body to:
   ```html
   <h1>Hello from AutoPilot!</h1>
   <p>This is a <strong>test email</strong> with HTML formatting.</p>
   <ul>
     <li>Feature 1: Discord</li>
     <li>Feature 2: Slack</li>
     <li>Feature 3: Telegram</li>
     <li>Feature 4: Email (SMTP)</li>
   </ul>
   ```
3. Run
4. ✅ Expected: Email arrives with formatted HTML content

**Test 3: Multiple Recipients**

1. Set To Email to: `user1@example.com, user2@example.com`
2. Run
3. ✅ Expected: Both recipients receive the email

**Test 4: Variable Interpolation**

1. Chain: Manual Trigger → HTTP Request → Email
2. Set Subject to: `Report for {{httpResult.name}}`
3. Set Body to: `Hello {{httpResult.name}}, your email is {{httpResult.email}}`
4. Run
5. ✅ Expected: Email contains interpolated data from the HTTP request

**Test 5: Custom SMTP Server**

1. Select **Custom SMTP** in the service dropdown
2. Fill in Host, Port, TLS fields for your provider
3. Run
4. ✅ Expected: Email sent via custom SMTP config

**Test 6: Invalid Credentials**

1. Use an incorrect app password
2. Run
3. ✅ Expected: Error with SMTP authentication failure message

**Test 7: Dynamic To Email**

1. Set To Email to: `{{previousStep.recipientEmail}}`
2. Run with a workflow that provides the email dynamically
3. ✅ Expected: Email sent to the dynamically resolved address

### 4.6 Verify Result Object

```json
{
  "success": true,
  "messageId": "<abc123@gmail.com>",
  "to": "recipient@example.com",
  "subject": "Test from AutoPilot",
  "timestamp": "2025-03-05T12:00:00.000Z",
  "provider": "email"
}
```

---

## Cross-Node Integration Tests

### Test A: Multi-Channel Notification Pipeline

Create a workflow that sends the same notification to all 4 channels:

```
Manual Trigger → HTTP Request → Discord → Slack → Telegram → Email
```

1. HTTP Request fetches `https://jsonplaceholder.typicode.com/users/1`
2. Each node uses `{{httpResult.name}}` in its message
3. Run → Verify all 4 channels receive the message
4. Check Inngest → all steps should show `success: true`

### Test B: Error Recovery

1. Configure Discord with a valid webhook, Slack with an invalid one
2. Run the pipeline
3. ✅ Expected: Discord succeeds, Slack shows error, subsequent nodes still execute

### Test C: Variable Chaining

```
Manual Trigger → Discord → Slack → Telegram
```

1. Discord message: `Starting pipeline`
2. Slack message: `Discord sent: {{discordResult.success}}`
3. Telegram message: `Slack sent: {{slackResult.success}}, Discord: {{discordResult.messageId}}`
4. ✅ Expected: Each node can reference previous node results

---

## Troubleshooting

### Common Issues

| Issue                      | Cause                             | Fix                                      |
| -------------------------- | --------------------------------- | ---------------------------------------- |
| "Credential not found"     | No credential saved               | Add credential in the node dialog        |
| Discord: 401 Unauthorized  | Invalid webhook URL               | Regenerate webhook in Discord settings   |
| Slack: unexpected response | Revoked or wrong webhook URL      | Create new webhook in Slack app settings |
| Telegram: "chat not found" | Wrong Chat ID                     | Verify with @userinfobot or API call     |
| Telegram: 401 Unauthorized | Wrong bot token                   | Check token from @BotFather              |
| Email: auth failed         | Wrong password or no App Password | Enable 2FA + generate App Password       |
| Email: connection refused  | Wrong SMTP host/port              | Verify SMTP settings for your provider   |
| Node stuck in "loading"    | Inngest not running               | Start: `npx inngest-cli@latest dev`      |
| DB migration error         | Neon DB sleeping                  | Visit Neon dashboard to wake the DB      |

### Checking Logs

1. **Inngest Dashboard** (`http://localhost:8288`): See each step's input/output and errors
2. **Next.js Terminal**: Server-side logs from executors
3. **Browser Console**: Client-side connection errors
4. **Node Status Indicators**: Green = success, Red = error, Spinning = loading

---

## Rate Limits Reference

| Service  | Limit                        | Notes                    |
| -------- | ---------------------------- | ------------------------ |
| Discord  | 5 requests / 5 seconds       | Per webhook              |
| Slack    | 1 message / second           | Per webhook              |
| Telegram | 30 messages / second         | 20/min to same group     |
| Gmail    | 500 emails / day (free)      | 2,000/day with Workspace |
| SendGrid | 100 emails / day (free tier) | Paid plans: 50k+/month   |

---

## Character Limits

| Service  | Max Length   | Behavior When Exceeded            |
| -------- | ------------ | --------------------------------- |
| Discord  | 2,000 chars  | Auto-truncated with `[truncated]` |
| Slack    | 40,000 chars | Auto-truncated with `[truncated]` |
| Telegram | 4,096 chars  | Auto-truncated with `[truncated]` |
| Email    | No limit     | Full message sent                 |
