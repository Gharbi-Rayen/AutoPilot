# Workflow HTTP Request Debug Report

**Date:** February 7, 2026  
**Issue:** Invalid URL Error in HTTP Request Node  
**Status:** 🔍 Investigating

---

## 🎯 Problem Summary

The workflow is successfully triggering from Google Forms but failing at the HTTP Request step with:

```
TypeError: Failed to parse URL
```

This occurs because the variable interpolation `{{googleFormData.responses.url}}` is resolving to `null`, `undefined`, or an empty string instead of the actual URL submitted through the Google Form.

---

## 📊 Current System Architecture

### 1. **Data Flow Pipeline**

```
Google Form Submission
    ↓
Google Apps Script (onFormSubmit trigger)
    ↓
Webhook: /api/webhooks/google-form?workflowId={id}
    ↓
Inngest Event: workflows/execute.workflow
    ↓
Google Form Trigger Executor (passes context through)
    ↓
HTTP Request Executor (fails here - invalid URL)
```

### 2. **Expected Data Structure**

#### Webhook Receives:

```json
{
  "formId": "...",
  "formTitle": "...",
  "responseId": "...",
  "timestamp": "...",
  "respondentEmail": "...",
  "responses": {
    "url": "https://example.com" // ← The critical field
  },
  "raw": {
    /* full form response */
  }
}
```

#### Context Structure in Inngest:

```json
{
  "googleFormData": {
    "formId": "...",
    "formTitle": "...",
    "responseId": "...",
    "timestamp": "...",
    "respondentEmail": "...",
    "responses": {
      "url": "https://example.com" // ← Should be accessible via {{googleFormData.responses.url}}
    },
    "raw": {
      /* full form response */
    }
  }
}
```

### 3. **Code Analysis**

#### Webhook Handler (`/api/webhooks/google-form/route.ts`)

```typescript
const formData = {
  formId: body.formId,
  formTitle: body.formTitle,
  responseId: body.responseId,
  timestamp: body.timestamp,
  respondentEmail: body.respondentEmail,
  responses: body.responses, // ← Direct mapping from body
  raw: body,
};

const result = await sendWorkflowExecution({
  workflowId: workflowId,
  initialData: {
    googleFormData: formData, // ← Wrapped in googleFormData
  },
});
```

#### HTTP Request Executor (`http-request/executor.ts`)

```typescript
const endpoint = Handlebars.compile(data.endpoint)(context);
const response = await ky(endpoint, options);
```

**Handlebars Template Resolution:**

- Input: `{{googleFormData.responses.url}}`
- Context: `{ googleFormData: { responses: { url: "..." } } }`
- Expected Output: `"https://example.com"`
- **Actual Output:** `null` or `undefined` (causing the error)

---

## 🔍 Potential Root Causes

### Most Likely Issues:

1. **Variable Name Mismatch**
   - User typed: `{{googleForm.responses.url}}` (missing "Data")
   - Should be: `{{googleFormData.responses.url}}`
   - Sensitivity: Case-sensitive, exact match required

2. **Google Form Field Mapping Issue**
   - The Google Apps Script might be sending responses with a different structure
   - Example: `responses: { "Question 1": "url value" }` instead of `responses: { "url": "..." }`
   - The question title in the form might not match the key name

3. **Empty/Null Response**
   - The URL field was left empty in the form submission
   - The field isn't being captured by the Apps Script trigger

4. **Script Generation Issue**
   - The generated Google Apps Script might not be correctly mapping the form fields
   - Field names might have special characters or spaces

---

## 🔧 Information Needed for Diagnosis

To pinpoint the exact issue, we need:

### 1. **Step Output from Inngest Dashboard**

Navigate to: Inngest Dashboard → Execution → Click on "google-form-trigger" step

**Expected location:** The step output JSON should show:

```json
{
  "googleFormData": {
    "responses": {
      "url": "actual-url-here" // ← We need to verify this structure
    }
  }
}
```

### 2. **Actual Variable Used in HTTP Request Node**

Check the HTTP Request node configuration in the workflow editor:

- Current variable: `{{???}}`
- Should verify exact spelling and casing

### 3. **Google Form Question Configuration**

- Exact question title as it appears in Google Forms
- Question type (Short Answer, Paragraph, etc.)
- Whether the question is marked as "Required"

### 4. **Google Apps Script Code**

The generated script that runs on form submission. Should look similar to:

```javascript
function onFormSubmit(e) {
  var formId = e.source.getId();
  var formTitle = e.source.getTitle();
  var responseId = e.response.getId();
  var itemResponses = e.response.getItemResponses();

  var responses = {};
  for (var i = 0; i < itemResponses.length; i++) {
    var itemResponse = itemResponses[i];
    var questionTitle = itemResponse.getItem().getTitle();
    responses[questionTitle] = itemResponse.getResponse();
  }

  // ... webhook call
}
```

---

## 🚀 Immediate Quick Fix to Test

Before gathering full diagnostic info, try this:

### Option 1: Update Variable Path

In the HTTP Request node, try these variations in order:

1. `{{googleFormData.responses.url}}` (current expected)
2. `{{event.data.googleFormData.responses.url}}`
3. `{{googleFormData.responses.URL}}` (capitalized)
4. `{{googleFormData.raw.responses.url}}` (from raw data)

### Option 2: Test with Hardcoded URL

Temporarily replace the variable with a hardcoded URL to verify HTTP request works:

```
https://jsonplaceholder.typicode.com/todos/1
```

If this works, the issue is definitely in variable resolution.

---

## 📋 Diagnostic Checklist

- [ ] Verify exact variable name in HTTP Request node configuration
- [ ] Check google-form-trigger step output in Inngest dashboard
- [ ] Inspect raw webhook payload structure
- [ ] Verify Google Form question title matches variable key
- [ ] Review generated Google Apps Script code
- [ ] Test with hardcoded URL to isolate variable issue
- [ ] Check for any console errors in webhook endpoint logs
- [ ] Verify form submission actually includes the URL field

---

## 🎯 Next Steps

1. **Gather diagnostic information** (listed above)
2. **Test quick fixes** while gathering info
3. **Analyze step output** to see exact data structure
4. **Update variable path** based on actual structure
5. **Test end-to-end** with new configuration
6. **Document solution** for future reference

---

## 📝 Notes

- The webhook endpoint is working correctly (receiving and processing data)
- The Inngest event is triggering successfully
- The Google Form trigger executor completes without errors
- The failure occurs specifically in the HTTP Request executor during URL parsing
- Handlebars template compilation is case-sensitive and requires exact key matches

---

## 🔗 Related Files

- Webhook Handler: `src/app/api/webhooks/google-form/route.ts`
- HTTP Request Executor: `src/features/executions/components/http-request/executor.ts`
- Google Form Executor: `src/features/triggers/components/googleForm-trigger/executor.ts`
- Inngest Workflow: `src/inngest/functions.ts`
- Channels: `src/inngest/channels/google-form-trigger.ts`

---

## ✅ ISSUE IDENTIFIED - SOLUTION CONFIRMED

### 🔍 Root Cause Found

**Problem:** Variable name mismatch in HTTP Request node configuration

**User Input:**

```json
{
  "googleFormData": {
    "responses": {
      "url": "https://jsonplaceholder.typicode.com/users/1"
    }
  }
}
```

**HTTP Request Configuration:**

- ❌ **Current (INCORRECT):** `{{googleForm.responses.url}}`
- ✅ **Correct:** `{{googleFormData.responses.url}}`

**The Fix:** Add the missing "Data" to the variable name - the context key is `googleFormData`, not `googleForm`.

### 🎯 Solution

Update your HTTP Request node endpoint from:

```
{{googleForm.responses.url}}
```

To:

```
{{googleFormData.responses.url}}
```

### ✅ Verified Data Structure

From Inngest step output:

```json
{
  "googleFormData": {
    "formId": "1pwy2_leaUWRyRS0yPUsem7DXHBlOW3kbiLgAWx9nV3g",
    "formTitle": "test auto pilot",
    "responses": {
      "url": "https://jsonplaceholder.typicode.com/users/1"  ✅ CONFIRMED
    },
    "timestamp": "2026-02-06T23:04:02.542Z"
  }
}
```

### 📋 Preventative Measures

**Recommendations to prevent future issues:**

1. **Add Variable Documentation in UI**
   - Show available context variables in the node configuration dialog
   - Display example variable paths

2. **Better Error Messages**
   - When Handlebars can't resolve a variable, log the attempted path
   - Show available top-level keys in error message

3. **Context Inspector**
   - Add a "View Available Variables" button in node dialogs
   - Show the current context structure at each step

4. **Variable Autocomplete**
   - Implement autocomplete for variable paths in input fields
   - Suggest based on actual context structure

---

**Report Status:** ✅ RESOLVED - Variable name mismatch identified and solution provided
