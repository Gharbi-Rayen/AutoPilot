# Data Flow & Analysis Testing Guide

This guide walks you through executing the combined tests for data aggregation, analysis, and merging using the AutoPilot workflow tool. We will perform tests on two separate datasets (File 1: Revenue Metrics, File 2: User Growth/Churn) and combine them to extract key performance indicators (KPIs).

## Prerequisites

- A properly configured AutoPilot local environment.
- Two sample CSV datasets mapped by a common identifier (e.g., `date`):
  1. `file1_revenue.csv`: Contains `date`, `revenue`, `active_users`.
  2. `file2_usage.csv`: Contains `date`, `new_users`, `churned_users`.

---

## 🔹 File 1 Tests (Revenue & ARPU Analysis)

**Goal:** Calculate ARPU, detect revenue drops > 20%, and aggregate weekly totals.

### Workflow Setup

1. **Trigger Node**: Add a `Manual Trigger` node to begin the execution context.
2. **File Reading**:
   - Add an **Upload File** or **Read File** node to import `file1_revenue.csv`.
3. **CSV Parsing**:
   - Add a **CSV Parse** node.
   - **Input Variable**: Map to the raw file output from the internal File node.
4. **Data Aggregation (Weekly Totals)**:
   - Add a **CSV Aggregate** node.
   - **Group By Field**: Select the variable containing the start of the week from the date.
   - **Operations**: Sum `revenue` and Average `active_users`.
5. **Logic & Analysis (ARPU & Drops)**:
   - Add a **Code Node** (or AI Node like **Gemini** / **OpenAI**) to execute data manipulation.
   - Iterate over the parsed JSON array and for each element:
     - `ARPU = revenue / active_users`
     - Compare current day's revenue to the previous day to check if `drop > 20%`.

---

## 🔹 File 2 Tests (Churn & Growth rate)

**Goal:** Detect churn spikes, compute growth rate, and flag underperforming days.

### Workflow Setup

1. **File Reading**:
   - Add another **Upload File** or **Read File** node to import `file2_usage.csv`.
2. **CSV Parsing**:
   - Add a **CSV Parse** node specifically configured for the usage data file.
3. **Logic & Analysis (Churn Logic)**:
   - Add a **Code Node** mapped to the parsed File 2 data.
   - Iterate over the rows to compute the growth rate: `Growth Rate = (new_users - churned_users) / total_users`.
   - Add logic to flag any record where `churned_users > new_users`. Use array mapping to attach a `high_churn_warning = true` boolean to flagged rows.

---

## 🔹 Combined Tests (Merge & KPI Dashboard)

**Goal:** Merge both files on date, compare revenue vs active users, and usage vs churn.

### Workflow Setup

1. **CSV Join**:
   - Add a **CSV Join** node to the canvas.
   - **Left Imput**: Mapped to the output of File 1's Parser.
   - **Right Input**: Mapped to the output of File 2's Parser.
   - **Join Key**: Configure the join property to target the `date` key present in both arrays. Ensure it’s set to an inner or left join.
2. **Dashboard Data Preparation**:
   - Pass the joined JSON object into an **AI Node** (e.g., Anthropic, OpenAI, or Gemini).
   - Provide a system prompt:
     > _"You hold combined data mapping Daily Revenue, ARPU, New Users, and Churn. Generate an HTML or Markdown KPI dashboard displaying 'Revenue vs Active Users' and 'Churn vs Usage'. Summarize critical flags where churn drops or revenue drops exceeded the thresholds."_
3. **Execution & Validation**:
   - Run the workflow using the manual trigger.
   - Confirm step-by-step functionality by inspecting the payload at the CSV Join step.
   - Review the final output from the AI Node to ensure that your metrics and merged inputs formatted cleanly into the requested KPI summary.
