# AutoPilot Variable Guide

**A comprehensive guide to using variables in AutoPilot workflows**

---

## 📚 Table of Contents

1. [Introduction](#introduction)
2. [Variable Syntax](#variable-syntax)
3. [Available Variables by Trigger Type](#available-variables-by-trigger-type)
4. [Common Variable Patterns](#common-variable-patterns)
5. [Debugging Variables](#debugging-variables)
6. [Common Mistakes](#common-mistakes)
7. [Advanced Usage](#advanced-usage)

---

## Introduction

AutoPilot workflows use **Handlebars.js** for variable interpolation. Variables allow you to pass data between workflow steps, making your workflows dynamic and powerful.

### Key Principles

- Variables are wrapped in double curly braces: `{{variableName}}`
- Variable names are **case-sensitive**: `{{googleFormData}}` ≠ `{{googleformdata}}`
- Use dot notation for nested properties: `{{parent.child.property}}`
- Variables are resolved using the workflow execution context

---

## Variable Syntax

### Basic Syntax

```handlebars
{{variableName}}
```

### Nested Properties

```handlebars
{{parent.child.grandchild}}
```

### JSON Stringification

Use the `json` helper to convert objects to JSON strings:

```handlebars
{{json myObject}}
```

**Example:**

```json
{
  "data": {{json googleFormData.responses}}
}
```

---

## Available Variables by Trigger Type

### 🔵 Google Form Trigger

When a Google Form submits data, the context contains:

```javascript
{
  googleFormData: {
    formId: "string",
    formTitle: "string",
    responseId: "string",
    timestamp: "ISO date string",
    respondentEmail: "string",
    responses: {
      // Form field responses key-value pairs
      "fieldName": "value",
      "anotherField": "value"
    },
    raw: {
      // Complete raw form response
    }
  }
}
```

**Variable Patterns:**

| Variable                             | Description           | Example Value                |
| ------------------------------------ | --------------------- | ---------------------------- |
| `{{googleFormData.formId}}`          | Google Form ID        | `1pwy2_leaUWR...`            |
| `{{googleFormData.formTitle}}`       | Form title            | `"Contact Form"`             |
| `{{googleFormData.responseId}}`      | Response ID           | `2_ABaOnuck...`              |
| `{{googleFormData.timestamp}}`       | Submission time       | `"2026-02-06T23:04:02.542Z"` |
| `{{googleFormData.respondentEmail}}` | Respondent email      | `"user@example.com"`         |
| `{{googleFormData.responses.url}}`   | Field named "url"     | `"https://example.com"`      |
| `{{googleFormData.responses.name}}`  | Field named "name"    | `"John Doe"`                 |
| `{{json googleFormData.responses}}`  | All responses as JSON | `{"url":"...","name":"..."}` |

**⚠️ Important:** The field name in `responses` must match the exact question title in your Google Form (case-sensitive).

### 🟢 HTTP Request Node

After an HTTP Request node executes, it stores the response in a variable you define:

```javascript
{
  [variableName]: {
    httpResponse: {
      status: 200,
      statusText: "OK",
      data: {
        // Response body (JSON or text)
      }
    }
  }
}
```

**Variable Patterns:**

If your HTTP Request node uses `variableName = "userApi"`:

| Variable                              | Description             | Example Value               |
| ------------------------------------- | ----------------------- | --------------------------- |
| `{{userApi.httpResponse.status}}`     | HTTP status code        | `200`                       |
| `{{userApi.httpResponse.statusText}}` | Status text             | `"OK"`                      |
| `{{userApi.httpResponse.data}}`       | Response body           | `{"id": 1, "name": "John"}` |
| `{{userApi.httpResponse.data.id}}`    | Specific field          | `1`                         |
| `{{userApi.httpResponse.data.name}}`  | Specific field          | `"John"`                    |
| `{{json userApi.httpResponse.data}}`  | Response as JSON string | `{"id":1,"name":"John"}`    |

### 🟡 Manual Trigger

When manually triggering a workflow, the context contains:

```javascript
{
  manualTriggerData: {
    // Custom data passed during manual trigger
  }
}
```

---

## Common Variable Patterns

### Pattern 1: Using Google Form Data in HTTP Request

**Scenario:** Send form data to an API

**Google Form Fields:**

- Question: "email" → User enters: `john@example.com`
- Question: "name" → User enters: `John Doe`

**HTTP Request Configuration:**

- **Endpoint:** `https://api.example.com/users`
- **Method:** `POST`
- **Body:**

```json
{
  "email": "{{googleFormData.responses.email}}",
  "name": "{{googleFormData.responses.name}}"
}
```

**Result:** API receives:

```json
{
  "email": "john@example.com",
  "name": "John Doe"
}
```

---

### Pattern 2: Chaining HTTP Requests

**Scenario:** Use data from one API call in another

**First HTTP Request (variableName: `getUserData`):**

- **Endpoint:** `https://api.example.com/users/1`
- **Method:** `GET`
- **Response:**

```json
{
  "id": 1,
  "email": "john@example.com",
  "orderId": "abc123"
}
```

**Second HTTP Request:**

- **Endpoint:** `https://api.shop.com/orders/{{getUserData.httpResponse.data.orderId}}`
- **Method:** `GET`
- **Resolved to:** `https://api.shop.com/orders/abc123`

---

### Pattern 3: Dynamic URL from Form

**Scenario:** User submits a URL via Google Form, and you want to make a request to it

**Google Form Field:**

- Question: "url" → User enters: `https://jsonplaceholder.typicode.com/users/1`

**HTTP Request Configuration:**

- **Endpoint:** `{{googleFormData.responses.url}}`
- **Method:** `GET`
- **Resolved to:** `https://jsonplaceholder.typicode.com/users/1`

**⚠️ This is the exact issue that was fixed in this project!**

---

## Debugging Variables

### Step 1: Check Inngest Dashboard

1. Go to Inngest Dashboard
2. Click on your workflow execution
3. Click on each step to view its output
4. Look for the "Step Output" panel on the right

**Example output:**

```json
{
  "googleFormData": {
    "responses": {
      "url": "https://example.com"
    }
  }
}
```

### Step 2: Verify Variable Path

From the step output, trace the path to your value:

```
googleFormData → responses → url
```

Variable: `{{googleFormData.responses.url}}`

### Step 3: Check Console Logs

With the improved error logging, check your console output:

```
[GoogleFormExecutor] Available variable paths:
  - {{googleFormData.formId}}: 1pwy2_leaUWR...
  - {{googleFormData.formTitle}}: test auto pilot
  - {{googleFormData.responses}}: {"url":"https://..."}
```

### Step 4: Test with Simple Paths

If `{{googleFormData.responses.url}}` doesn't work, test:

1. `{{googleFormData}}` → Should return the entire object
2. `{{googleFormData.responses}}` → Should return the responses object
3. `{{googleFormData.responses.url}}` → Should return the URL value

This helps isolate where the issue is.

---

## Common Mistakes

### ❌ Mistake 1: Typo in Variable Name

**Wrong:**

```handlebars
{{googleForm.responses.url}}
```

**Right:**

```handlebars
{{googleFormData.responses.url}}
```

**Why:** The context key is `googleFormData`, not `googleForm`.

---

### ❌ Mistake 2: Case Sensitivity

**Wrong:**

```handlebars
{{googleformdata.responses.url}}
```

**Right:**

```handlebars
{{googleFormData.responses.url}}
```

**Why:** JavaScript object keys are case-sensitive.

---

### ❌ Mistake 3: Field Name Mismatch

**Google Form Question:** "Website URL"

**Wrong:**

```handlebars
{{googleFormData.responses.url}}
```

**Right:**

```handlebars
{{googleFormData.responses.Website URL}}
```

**Why:** The key in `responses` matches the exact question title, including spaces and capitalization.

**Better:** Rename your Google Form question to "url" (lowercase, no spaces) for easier variable usage.

---

### ❌ Mistake 4: Missing JSON Helper for Objects

**Wrong:** (trying to pass object directly)

```json
{
  "data": {{myApiResponse.httpResponse.data}}
}
```

**Right:**

```json
{
  "data": {{json myApiResponse.httpResponse.data}}
}
```

**Why:** Objects must be stringified to JSON format.

---

### ❌ Mistake 5: Using Previous Variable Name

**Scenario:** You have two HTTP Request nodes

**First Node:** variableName = `getUserData`
**Second Node:** variableName = `getOrderData`

**Wrong:** (in third node)

```handlebars
{{getUserData.httpResponse.data}}
{{getOrderData.httpResponse.data}}
```

Works! ✅

**Wrong:** (trying to use a non-existent variable)

```handlebars
{{apiCall.httpResponse.data}}
```

Fails! ❌ No node with variableName `apiCall` exists.

---

## Advanced Usage

### Conditional Logic (Future Feature)

Currently not supported, but planned:

```handlebars
{{#if googleFormData.responses.premium}}
  https://api.example.com/premium/users
{{else}}
  https://api.example.com/standard/users
{{/if}}
```

### Array Access

If an API returns an array:

```json
{
  "users": [
    { "id": 1, "name": "John" },
    { "id": 2, "name": "Jane" }
  ]
}
```

Access first element:

```handlebars
{{myApi.httpResponse.data.users.[0].name}}
```

Result: `"John"`

### Nested JSON Stringification

```handlebars
{ "metadata": { "formData":
{{json googleFormData.responses}}
} }
```

Result:

```json
{
  "metadata": {
    "formData": {
      "url": "https://example.com",
      "name": "John"
    }
  }
}
```

---

## Quick Reference

### Syntax Cheat Sheet

```handlebars
{{variableName}}
- Simple variable
{{parent.child}}
- Nested property
{{parent.child.grandchild}}
- Deep nesting
{{json myObject}}
- Object to JSON string
{{myArray.[0]}}
- Array element
{{myArray.[0].property}}
- Array element property
```

### Common Variable Paths

```handlebars
// Google Form
{{googleFormData.formTitle}}
{{googleFormData.responses.fieldName}}
{{googleFormData.timestamp}}

// HTTP Request
{{variableName.httpResponse.status}}
{{variableName.httpResponse.data}}
{{variableName.httpResponse.data.id}}

// Manual Trigger
{{manualTriggerData.customField}}
```

---

## Troubleshooting Checklist

- [ ] Variable name matches exactly (case-sensitive)
- [ ] No typos in the path
- [ ] Checked step output in Inngest dashboard
- [ ] Google Form field name matches question title
- [ ] Used correct variable name from HTTP Request node
- [ ] Used `{{json ...}}` for objects
- [ ] Tested with simpler path first
- [ ] Reviewed console logs for debugging info

---

## Getting Help

If you're still having issues:

1. **Check step output:** Look at the exact data structure in Inngest
2. **Review console logs:** Check for debugging information
3. **Test incrementally:** Start with simple variable paths
4. **Verify field names:** Ensure Google Form questions match your variables
5. **Check documentation:** Review this guide and solution docs

---

**Last Updated:** February 7, 2026  
**Version:** 1.0
