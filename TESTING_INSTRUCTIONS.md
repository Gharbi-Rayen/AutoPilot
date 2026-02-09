# Testing Instructions: HTTP Request Variable Fix

**Goal:** Verify that the HTTP Request node works correctly with the updated variable path

---

## 🎯 Quick Fix Action Required

### Update Your Workflow

1. **Open AutoPilot Dashboard**
   - Navigate to your workflow

2. **Edit the HTTP Request Node**
   - Click on the HTTP Request node (the one after Google Form trigger)
   - Open the node configuration dialog

3. **Update the Endpoint URL**
   - **Current (WRONG):** `{{googleForm.responses.url}}`
   - **New (CORRECT):** `{{googleFormData.responses.url}}`
4. **Save the Workflow**
   - Click "Save" or "Update"
   - Ensure the workflow is saved successfully

---

## ✅ Testing Steps

### Test 1: End-to-End Workflow Test

1. **Open Your Google Form**
   - Navigate to your Google Form (the one connected to this workflow)

2. **Submit a Test Response**
   - Fill in the "url" field with: `https://jsonplaceholder.typicode.com/users/1`
   - Submit the form

3. **Check Inngest Dashboard**
   - Go to Inngest Dashboard: https://app.inngest.com
   - Find your workflow execution (should appear within a few seconds)
   - Check the status of each step:
     - ✅ `google-form-trigger` should show "completed"
     - ✅ `http-request` should show "completed" (no error!)

4. **Verify the HTTP Request Output**
   - Click on the `http-request` step
   - Check the "Step Output" panel on the right
   - You should see the API response data:
   ```json
   {
     "id": 1,
     "name": "Leanne Graham",
     "username": "Bret",
     "email": "Sincere@april.biz",
     ...
   }
   ```

---

### Test 2: Verify Variable Resolution

1. **Check the Step Output of `google-form-trigger`**
   - In Inngest, click on the `google-form-trigger` step
   - Verify the structure:

   ```json
   {
     "googleFormData": {
       "responses": {
         "url": "https://jsonplaceholder.typicode.com/users/1"
       }
     }
   }
   ```

2. **Confirm Variable Path**
   - The path from root to value is: `googleFormData` → `responses` → `url`
   - Variable should be: `{{googleFormData.responses.url}}`
   - ✅ This matches what you just updated!

---

### Test 3: Different URLs

Test with various URLs to ensure robustness:

**Test 3.1: Different JSONPlaceholder Endpoint**

- URL: `https://jsonplaceholder.typicode.com/posts/1`
- Expected: Should successfully fetch post data

**Test 3.2: Another API**

- URL: `https://api.github.com/users/github`
- Expected: Should successfully fetch GitHub user data

**Test 3.3: Your Own API (if applicable)**

- URL: `https://your-api.com/endpoint`
- Expected: Should successfully make the request

---

## 🔍 Checking Logs

### Console Logs (Dev Environment)

If running locally, check your terminal for logs:

```bash
# You should see these logs:
[GoogleFormExecutor] Available variable paths:
  - {{googleFormData.formId}}: 1pwy2_leaUWR...
  - {{googleFormData.formTitle}}: test auto pilot
  - {{googleFormData.responses}}: {"url":"https://..."}

[HttpRequestExecutor] Endpoint compiled:
  template: {{googleFormData.responses.url}}
  compiled: https://jsonplaceholder.typicode.com/users/1

[HttpRequestExecutor] Request completed: { nodeId: '...', variableName: '...' }
```

### Inngest Logs

1. In Inngest Dashboard, click on the execution
2. Each step shows its logs
3. Look for:
   - ✅ No errors
   - ✅ Successful status codes (200, 201, etc.)
   - ✅ Response data populated

---

## ❌ Troubleshooting Failed Tests

### Issue: Still Getting "Failed to parse URL"

**Possible Causes:**

1. **Variable not updated correctly**
   - Double-check: Is it `{{googleFormData.responses.url}}`?
   - Not `{{googleForm.responses.url}}`?

2. **Workflow not saved**
   - Make sure you clicked "Save" after editing
   - Refresh the page and verify the change persisted

3. **Using old workflow version**
   - The execution might be using a cached version
   - Try creating a new test submission

4. **Field name mismatch**
   - Check your Google Form question title
   - It should be exactly "url" (lowercase)
   - If it's "URL" or "Url", update the variable accordingly

---

### Issue: Empty Response

**Possible Causes:**

1. **API endpoint is down**
   - Test the URL directly in your browser or Postman
   - Try using JSONPlaceholder first: `https://jsonplaceholder.typicode.com/users/1`

2. **HTTP method incorrect**
   - Verify the endpoint accepts GET requests
   - Check API documentation

---

### Issue: Workflow doesn't trigger

**Possible Causes:**

1. **Google Apps Script not installed**
   - Check if the script is still active in your Google Form
   - Re-generate and install if needed

2. **Webhook URL changed**
   - Verify the webhook URL in Google Apps Script matches your deployment

3. **Ngrok not running (if using locally)**
   - Make sure ngrok is active
   - Check that the forwarding URL is correct

---

## 🎉 Expected Success Result

After completing the fix and running tests, you should see:

### In Inngest Dashboard:

```
✅ Execution: COMPLETED

Steps:
  ✅ prepare-workflow (completed)
  ✅ google-form-trigger (completed)
  ✅ http-request (completed)
```

### Step Output (http-request):

```json
{
  "googleFormData": { ... },
  "yourVariableName": {
    "httpResponse": {
      "status": 200,
      "statusText": "OK",
      "data": {
        "id": 1,
        "name": "Leanne Graham",
        ...
      }
    }
  }
}
```

### Console Output:

```
[Inngest] executeWorkflow triggered with event
[GoogleFormExecutor] Processing context
[GoogleFormExecutor] Available variable paths:
  - {{googleFormData.responses}}: {"url":"https://..."}
[HttpRequestExecutor] Endpoint compiled: https://jsonplaceholder.typicode.com/users/1
[HttpRequestExecutor] Request completed
✅ Workflow execution successful
```

---

## 📋 Testing Checklist

Before marking this as resolved:

- [ ] Updated HTTP Request node variable from `{{googleForm...}}` to `{{googleFormData...}}`
- [ ] Saved the workflow
- [ ] Submitted a test Google Form response
- [ ] Verified `google-form-trigger` step shows "completed" in Inngest ✅
- [ ] Verified `http-request` step shows "completed" in Inngest ✅
- [ ] Checked http-request step output contains valid API response ✅
- [ ] Tested with multiple different URLs ✅
- [ ] No errors in console logs ✅
- [ ] No errors in Inngest dashboard ✅

---

## 🚀 Next Steps After Successful Testing

Once testing is complete:

1. **Document your workflow**
   - Note which variables are available from each trigger
   - Reference [VARIABLE_GUIDE.md](VARIABLE_GUIDE.md) for patterns

2. **Build more complex workflows**
   - Chain multiple HTTP requests
   - Use data from one API call in another
   - Combine form data with external APIs

3. **Monitor production usage**
   - Keep an eye on Inngest dashboard for any failures
   - Set up alerts for failed executions

---

## 📞 Need Help?

If tests still fail after following these instructions:

1. **Check the diagnostic report:** [WORKFLOW_HTTP_REQUEST_DEBUG_REPORT.md](WORKFLOW_HTTP_REQUEST_DEBUG_REPORT.md)
2. **Review the solution guide:** [SOLUTION_VARIABLE_NAME_FIX.md](SOLUTION_VARIABLE_NAME_FIX.md)
3. **Consult the variable guide:** [VARIABLE_GUIDE.md](VARIABLE_GUIDE.md)
4. **Gather information:**
   - Screenshot of Inngest execution
   - Step outputs from each step
   - Console logs
   - Your workflow configuration

---

**Testing Guide Version:** 1.0  
**Last Updated:** February 7, 2026
