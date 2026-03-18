# CSV and PDF Testing Workflow

This guide outlines a comprehensive testing scenario for validating CSV operations (Join, Parse, Filter, Aggregate, Generate), AI integration, and PDF Report Generation.

## Prerequisites

- **Files**: Ensure you have `file1_revenue.csv` and `file2_usage.csv` ready for upload.
- **API Keys**: Ensure your AI provider (OpenAI, Anthropic, or Gemini) is configured.

## Workflow Overview

We will create a workflow that:

1.  **Ingests** two CSV files (Revenue and Usage data).
2.  **Joins** them into a single dataset based on date.
3.  **Filters** for high-revenue days.
4.  **Analyzes** the trends using AI.
5.  **Generates** a clean CSV export of the high-value days.
6.  **Generates** a PDF management report containing the AI analysis.

## Step-by-Step Configuration

### 1. Trigger

- **Type**: Manual Trigger
- **Name**: `Start Analysis`

### 2. File Uploads

- **Node A (Upload)**:
  - **Variable Name**: `revenueFile`
  - **Description**: Upload `file1_revenue.csv`
- **Node B (Upload)**:
  - **Variable Name**: `usageFile`
  - **Description**: Upload `file2_usage.csv`

### 3. CSV Parsing

- **Node C (CSV Parse)**:
  - **Source Variable**: `revenueFile`
  - **Variable Name**: `revenueData`
- **Node D (CSV Parse)**:
  - **Source Variable**: `usageFile`
  - **Variable Name**: `usageData`

### 4. CSV Join

- **Node E (CSV Join)**:
  - **Left Variable**: `revenueData`
  - **Right Variable**: `usageData`
  - **Left Key**: `date`
  - **Right Key**: `date`
  - **Variable Name**: `combinedData`
  - **Join Type**: `inner`

### 5. CSV Filter

- **Node F (CSV Filter)**:
  - **Source Variable**: `combinedData`
  - **Variable Name**: `highRevenueDays`
  - **Field**: `revenue`
  - **Operator**: `gt`
  - **Value**: `50000` (Filter for days with > $50k revenue)

### 6. CSV Aggregate (Optional Verification)

- **Node G (CSV Aggregate)**:
  - **Source Variable**: `highRevenueDays`
  - **Variable Name**: `weeklyStats`
  - **Group By**: `week_start` (if available in data) or `date`
  - **Operation**: `sum`
  - **Target Field**: `revenue`

### 7. AI Analysis

- **Node H (AI / Gemini or OpenAI)**:
  - **System Prompt**: "You are a data analyst. Analyze the provided daily telecom stats."
  - **User Prompt**: "Here is the data for our highest revenue days:\n\n{{highRevenueDays}}\n\nProvide a summary of the correlation between 'revenue' and 'new_users'. identifying any trends. Keep it concise (1 paragraph)."
  - **Variable Name**: `aiSummary`

### 8. Generate Report Files

#### A. Generate CSV Export

- **Node I (CSV Generate)**:
  - **Source Variable**: `highRevenueDays`
  - **Variable Name**: `exportCsv`
  - **Include Header**: `true`

#### B. Generate PDF Report

- **Node J (PDF Generate - NEW)**:
  - **Content Variable**: `aiSummary` (The text output from the AI node)
  - **Title**: "High Revenue Days Analysis"
  - **Variable Name**: `pdfReport`
  - **File Name**: `analysis_report.pdf`

## Validation

1.  **Execute** the workflow.
2.  **Check Output**:
    - `combinedData` should have columns from both files (`revenue`, `active_users`, `new_users`, `churned_users`).
    - `highRevenueDays` should only contain rows where `revenue > 50000`.
    - `aiSummary` should contain a text paragraph.
    - `exportCsv` should be a downloadable CSV file string/buffer.
    - `pdfReport` should be a downloadable PDF file.
