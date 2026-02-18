# Solution: HTTP Request Variable Name Fix

**Date:** February 7, 2026  
**Issue:** Invalid URL error in HTTP Request node  
**Status:** ✅ RESOLVED

---

## 🎯 Quick Fix

### The Problem

Your HTTP Request node was configured with:

```
{{googleForm.responses.url}}
```

But the actual context key is `googleFormData` (with "Data" at the end).

### The Solution

Update your HTTP Request node endpoint to:

```
{{googleFormData.responses.url}}
```

---

## 📝 How to Apply the Fix

### Step 1: Open Your Workflow Editor

1. Navigate to your workflow in the AutoPilot dashboard
2. Locate the HTTP Request node (the one after the Google Form trigger)

### Step 2: Edit the HTTP Request Node

1. Click on the HTTP Request node to select it
2. Click the settings/edit button (or double-click the node)
3. Find the "Endpoint URL" field

### Step 3: Update the Variable

Replace:

```
{{googleForm.responses.url}}
```

With:

```
{{googleFormData.responses.url}}
```

### Step 4: Save and Test

1. Click "Save" or "Update" to save your changes
2. Submit a test through your Google Form
3. Check the Inngest dashboard to verify the execution succeeds

---

## 🔍 Understanding the Issue

### Data Flow Visualization

```
┌─────────────────┐
│  Google Form    │
│  Submission     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Apps Script    │
│  onFormSubmit   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Webhook: /api/webhooks/google-form     │
│                                         │
│  Creates: {                             │
│    googleFormData: {           ← NOTE  │
│      responses: {                       │
│        url: "https://..."               │
│      }                                  │
│    }                                    │
│  }                                      │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Inngest Event                          │
│  workflows/execute.workflow             │
│                                         │
│  initialData: {                         │
│    googleFormData: { ... }              │
│  }                                      │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Google Form Trigger Node               │
│  ✅ Passes context through              │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  HTTP Request Node                      │
│                                         │
│  Handlebars compilation:                │
│  {{googleFormData.responses.url}}       │
│         ↓                               │
│  "https://jsonplaceholder.../users/1"   │
│         ↓                               │
│  ✅ Makes HTTP request successfully     │
└─────────────────────────────────────────┘
```

### Why It Failed Before

Handlebars template compilation is **exact match only**. When you used:

```javascript
{
  {
    googleForm.responses.url;
  }
}
//    ↑ looking for this key
```

In a context that has:

```javascript
{
  googleFormData: { ... }
  //        ↑ but key is actually this
}
```

Handlebars returns `undefined`, which becomes an empty string, causing:

```
TypeError: Failed to parse URL from ""
```

---

## 🛡️ Preventing Future Issues

### 1. Use Exact Variable Names

Always check the step output in Inngest to see the exact structure:

📍 **How to view step output:**

1. Go to Inngest dashboard
2. Click on your workflow execution
3. Click on the trigger step (e.g., "google-form-trigger")
4. View "Step Output" panel on the right
5. Copy the exact key names

### 2. Variable Naming Convention

The webhook wraps data in specific keys:

| Trigger Type        | Context Key         | Example Variable Path                    |
| ------------------- | ------------------- | ---------------------------------------- |
| Google Form         | `googleFormData`    | `{{googleFormData.responses.fieldName}}` |
| Manual Trigger      | `manualTriggerData` | `{{manualTriggerData.inputName}}`        |
| HTTP Request Result | `{variableName}`    | `{{myApiCall.httpResponse.data}}`        |

### 3. Common Variable Patterns

```handlebars
{{! Google Form submissions }}
{{googleFormData.responses.fieldName}}
{{googleFormData.formTitle}}
{{googleFormData.timestamp}}

{{! HTTP Request responses }}
{{variableName.httpResponse.data}}
{{variableName.httpResponse.status}}

{{! JSON stringification }}
{{json myObject}}
```

### 4. Debugging Tips

If a variable isn't working:

1. **Check spelling and casing** - Variables are case-sensitive
2. **View step output** - Verify the actual structure
3. **Test with console.log** - Add temporary logging in executors
4. **Use simple paths first** - Test `{{googleFormData}}` before `{{googleFormData.responses.url}}`

---

## 🧪 Testing Your Fix

### Test Checklist

- [ ] Variable updated in HTTP Request node
- [ ] Workflow saved
- [ ] Test submission sent through Google Form
- [ ] Inngest execution shows "success" status
- [ ] HTTP Request step completes without errors
- [ ] Response data is captured correctly

### Expected Result

After fixing the variable name, your Inngest execution should show:

```
✅ google-form-trigger (completed)
✅ http-request (completed)
```

And the HTTP Request step output should contain the response from the API.

---

## 📚 Additional Resources

### Relevant Code Files

- **Webhook Handler:** [src/app/api/webhooks/google-form/route.ts](src/app/api/webhooks/google-form/route.ts)
- **HTTP Executor:** [src/features/executions/components/http-request/executor.ts](src/features/executions/components/http-request/executor.ts)
- **Google Form Executor:** [src/features/triggers/components/googleForm-trigger/executor.ts](src/features/triggers/components/googleForm-trigger/executor.ts)

### Variable Template System

The system uses [Handlebars.js](https://handlebarsjs.com/) for variable interpolation:

**Basic syntax:**

```handlebars
{{variableName}}
```

**Nested properties:**

```handlebars
{{parent.child.property}}
```

**JSON helper (for objects):**

```handlebars
{{json myObject}}
```

---

## ✅ Conclusion

The issue was a simple typo: `googleForm` instead of `googleFormData`.

**Before:** `{{googleForm.responses.url}}` ❌  
**After:** `{{googleFormData.responses.url}}` ✅

Make this change in your HTTP Request node configuration and your workflow will execute successfully! 🎉

---

**Need Help?** If the issue persists after this fix, check:

1. The Google Form question is titled exactly "url" (case-sensitive)
2. The form submission includes a valid URL
3. The webhook is receiving the data (check Next.js logs)
4. The Inngest event is triggering (check Inngest dashboard)
