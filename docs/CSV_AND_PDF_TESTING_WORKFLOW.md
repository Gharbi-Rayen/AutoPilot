# CSV and PDF Testing Workflow Guide

This guide outlines a comprehensive testing scenario for validating CSV operations (Join, Parse, Filter, Aggregate, Generate), AI integration, and PDF Report Generation.

## Prerequisites

- **Files**: Ensure you have `file1_revenue.csv` and `file2_usage.csv` ready for upload.
- **API Keys**: Ensure your AI provider (OpenAI, Anthropic, or Gemini) is configured.

## Workflow Overview

We will create a workflow that:

1.  **Ingests** two CSV files (Revenue and Usage data).
2.  **Joins** them into a single dataset based on date.
3.  **Filters** for high-revenue days.
4.  **Prepares** the data for AI analysis (JSON Stringification).
5.  **Analyzes** the trends using AI.
6.  **Generates** a clean CSV export of the high-value days.
7.  **Generates** a PDF management report containing the AI analysis.

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

### 6. Data Preparation (Crucial Step)

To prevent the AI node from receiving `[object Object]`, we must convert the filtered data into a string format.

- **Node G (Code Node)**:
  - **Variable Name**: `dataForAI`
  - **Code**:
    ```javascript // Access variables through the 'context' object
    const highRevenueDays = context.highRevenueDays;
    return {
      // Use JSON.stringify to make the data readable for the AI
      stringifiedData: JSON.stringify(highRevenueDays.records, null, 2),
    };
    ```

### 7. AI Analysis

- **Node H (AI / Gemini or OpenAI)**:
  - **System Prompt**: "You are a data analyst. Analyze the provided daily telecom stats."
  - **User Prompt**: "Here is the data for our highest revenue days:\n\n{{dataForAI.stringifiedData}}\n\nProvide a summary of the correlation between 'revenue' and 'new_users'. identifying any trends. Keep it concise (1 paragraph)."
  - **Variable Name**: `aiSummary`

### 8. Generate Report Files

#### A. Generate CSV Export

- **Node I (CSV Generate)**:
  - **Source Variable**: `highRevenueDays`
  - **Variable Name**: `exportCsv`
  - **Include Header**: `true`

#### B. Generate PDF Report

- **Node J (PDF Generate)**:
  - **Content Variable**: `aiSummary` (The text output from the AI node)
  - **Title**: "High Revenue Days Analysis"
  - **Variable Name**: `pdfReport`
  - **File Name**: `analysis_report.pdf`
  - **Configuration**:
    - **Output Variable Name**: `pdfReport`
    - **Content Source Variable**: `aiSummary`
    - **Title**: `High Revenue Days Analysis`
    - **File Name**: `analysis_report.pdf`

## Validation Checklist

1.  **Execute** the workflow.
2.  **Check Output**:
    - **CSV Join**: `combinedData` should have 30 rows with merged columns.
    - **CSV Filter**: `highRevenueDays` should have **11 rows** (days with revenue > 50k).
    - **Code Node**: `dataForAI` should contain a valid JSON string of the 11 records.
    - **AI Analysis**: `aiSummary` should be a coherent text paragraph, not an error message about missing data.
    - **PDF Report**: Go to the **Execution Details** page. Look for the **Generated Files** section (above the raw output). Click the **Download** button for `pdfReport` and `exportCsv` to verify the files.
