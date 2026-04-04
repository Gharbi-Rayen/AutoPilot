# AutoPilot Documentation

This directory contains all technical documentation for the AutoPilot workflow automation platform.

**Last Updated:** April 3, 2026

---

## 📚 Documentation Structure

### Core Architecture

| Document | Description | Audience |
|----------|-------------|----------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Node Data Flow Architecture - detailed technical specification for data processing pipeline | Senior Engineers, Performance Team |
| [ARCHITECTURE_CRITIQUE.md](./ARCHITECTURE_CRITIQUE.md) | Comprehensive critique of the application's architecture, strengths, weaknesses, and recommendations | Engineering Leadership, Architects |
| [GLOBAL_ROADMAP.md](./GLOBAL_ROADMAP.md) | Complete file-by-file map of the entire codebase with descriptions | All Engineers, New Team Members |
| [FEATURES_OVERVIEW.md](./FEATURES_OVERVIEW.md) | High-level overview of all implemented features and node types | Product Team, Engineers |

---

### Implementation & Performance

| Document | Description | Status |
|----------|-------------|--------|
| [NODE_DATA_FLOW_ANSWERS_AND_UPGRADE_PLAN.md](./NODE_DATA_FLOW_ANSWERS_AND_UPGRADE_PLAN.md) | Detailed answers to data flow questions and 400MB upgrade architecture plan | ✅ Implemented |
| [NODE_DATA_FLOW_IMPLEMENTATION_TICKETS.md](./NODE_DATA_FLOW_IMPLEMENTATION_TICKETS.md) | 28 implementation tickets for data flow refactoring (all completed) | ✅ Complete |
| [NODE_DATA_FLOW_BENCHMARKS.md](./NODE_DATA_FLOW_BENCHMARKS.md) | Benchmark harness documentation for 100MB/250MB/400MB datasets | Active |
| [NODE_DATA_FORMAT_EVOLUTION.md](./NODE_DATA_FORMAT_EVOLUTION.md) | Migration path from JSONL to columnar storage format | Future |
| [WORKFLOW_EXECUTION_PERFORMANCE_GUIDE.md](./WORKFLOW_EXECUTION_PERFORMANCE_GUIDE.md) | Performance optimization guide for workflow execution | Active |
| [DATABASE_QUERY_OPTIMIZATION.md](./DATABASE_QUERY_OPTIMIZATION.md) | Database index strategy and query optimization | ✅ Implemented |
| [QUEUE_BACKEND_MIGRATION.md](./QUEUE_BACKEND_MIGRATION.md) | Migration from file-based to Redis/BullMQ queue system | ✅ Implemented |

---

### Integration Guides

| Document | Description | Audience |
|----------|-------------|----------|
| [AI_NODES_IMPLEMENTATION.md](./AI_NODES_IMPLEMENTATION.md) | Guide for implementing AI nodes (OpenAI, Anthropic, Gemini) | Engineers |
| [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md) | Stripe webhook integration architecture | Engineers |
| [STRIPE_TESTING_GUIDE.md](./STRIPE_TESTING_GUIDE.md) | Testing guide for Stripe webhook triggers | QA, Engineers |
| [MESSAGING_NODES_TESTING_GUIDE.md](./MESSAGING_NODES_TESTING_GUIDE.md) | Testing guide for messaging nodes (Discord, Slack, Telegram, Email, WhatsApp) | QA, Engineers |

---

### Testing & Workflows

| Document | Description | Audience |
|----------|-------------|----------|
| [TESTING_INSTRUCTIONS.md](./TESTING_INSTRUCTIONS.md) | General testing instructions and setup guide | QA, Engineers |
| [DATA_ANALYSIS_TESTING_GUIDE.md](./DATA_ANALYSIS_TESTING_GUIDE.md) | Testing guide for data aggregation and analysis workflows | QA, Product |
| [CSV_AND_PDF_TESTING_WORKFLOW.md](./CSV_AND_PDF_TESTING_WORKFLOW.md) | Comprehensive CSV/PDF testing scenario | QA, Product |
| [VARIABLE_GUIDE.md](./VARIABLE_GUIDE.md) | Guide for using variables and Handlebars templates in workflows | Users, Support |

---

### Archive (Completed/Outdated)

Historical documents moved to `archive/` folder:

| Document | Reason for Archive | Date Archived |
|----------|-------------------|---------------|
| [CONTEXT_ACCUMULATION_FIX_REPORT.md](./archive/CONTEXT_ACCUMULATION_FIX_REPORT.md) | Bug fixed - context now accumulates correctly | 2026-04-03 |
| [CSV_AGGREGATE_INVESTIGATION_REPORT.md](./archive/CSV_AGGREGATE_INVESTIGATION_REPORT.md) | Investigation complete - null handling fixed | 2026-04-03 |
| [CSV_PDF_UI_FUNCTIONS_REPORT.md](./archive/CSV_PDF_UI_FUNCTIONS_REPORT.md) | Status report - all nodes now implemented | 2026-04-03 |
| [WORKFLOW_HTTP_REQUEST_DEBUG_REPORT.md](./archive/WORKFLOW_HTTP_REQUEST_DEBUG_REPORT.md) | Debug complete - variable name issue resolved | 2026-04-03 |
| [WORKFLOW_PANEL_TRACE_INVESTIGATION_REPORT.md](./archive/WORKFLOW_PANEL_TRACE_INVESTIGATION_REPORT.md) | Investigation complete - panel ordering fixed | 2026-04-03 |
| [SOLUTION_VARIABLE_NAME_FIX.md](./archive/SOLUTION_VARIABLE_NAME_FIX.md) | Solution applied - variable naming documented | 2026-04-03 |

---

## 🎯 Quick Navigation

### For New Engineers
1. Start with [GLOBAL_ROADMAP.md](./GLOBAL_ROADMAP.md) to understand the codebase structure
2. Read [FEATURES_OVERVIEW.md](./FEATURES_OVERVIEW.md) to understand what the platform does
3. Review [ARCHITECTURE.md](../ARCHITECTURE.md) for data flow architecture
4. Check [ARCHITECTURE_CRITIQUE.md](./ARCHITECTURE_CRITIQUE.md) for known issues and recommendations

### For Performance Work
1. [ARCHITECTURE.md](../ARCHITECTURE.md) - Core data flow architecture
2. [NODE_DATA_FLOW_ANSWERS_AND_UPGRADE_PLAN.md](./NODE_DATA_FLOW_ANSWERS_AND_UPGRADE_PLAN.md) - 400MB upgrade plan
3. [NODE_DATA_FLOW_BENCHMARKS.md](./NODE_DATA_FLOW_BENCHMARKS.md) - Benchmark harness
4. [WORKFLOW_EXECUTION_PERFORMANCE_GUIDE.md](./WORKFLOW_EXECUTION_PERFORMANCE_GUIDE.md) - Optimization guide

### For Feature Development
1. [GLOBAL_ROADMAP.md](./GLOBAL_ROADMAP.md) - Find relevant files
2. [AI_NODES_IMPLEMENTATION.md](./AI_NODES_IMPLEMENTATION.md) - AI node patterns
3. [MESSAGING_NODES_TESTING_GUIDE.md](./MESSAGING_NODES_TESTING_GUIDE.md) - Messaging patterns

### For QA/Testing
1. [TESTING_INSTRUCTIONS.md](./TESTING_INSTRUCTIONS.md) - General setup
2. [DATA_ANALYSIS_TESTING_GUIDE.md](./DATA_ANALYSIS_TESTING_GUIDE.md) - Data workflows
3. [CSV_AND_PDF_TESTING_WORKFLOW.md](./CSV_AND_PDF_TESTING_WORKFLOW.md) - CSV/PDF testing
4. [STRIPE_TESTING_GUIDE.md](./STRIPE_TESTING_GUIDE.md) - Stripe integration testing

---

## 📊 Documentation Health

| Category | Status | Notes |
|----------|--------|-------|
| Architecture | ✅ Excellent | Comprehensive coverage with critique |
| Performance | ✅ Excellent | Detailed benchmarks and optimization guides |
| Testing | ⚠️ Good | Manual guides exist, automated tests needed |
| Security | ⚠️ Needs Work | No dedicated security documentation |
| Deployment | ❌ Missing | No deployment or operations guide |
| API Reference | ❌ Missing | No API documentation for external integrations |

---

## 🔄 Documentation Maintenance

### When to Update

- **GLOBAL_ROADMAP.md**: When adding/removing files or major refactoring
- **FEATURES_OVERVIEW.md**: When adding new node types or features
- **ARCHITECTURE.md**: When changing data flow or storage architecture
- **Performance Guides**: When optimizations are implemented
- **Testing Guides**: When test procedures change

### Archive Policy

Move documents to `archive/` when:
- Bug/issue is resolved and documented
- Investigation is complete
- Feature is fully implemented and stable
- Document is superseded by newer documentation

### Missing Documentation (TODO)

1. **Deployment Guide** - How to deploy to production (Vercel, Docker, etc.)
2. **Operations Runbook** - How to monitor, debug, and maintain production
3. **Security Guide** - Security best practices, threat model, incident response
4. **API Reference** - External API documentation for integrations
5. **Contributing Guide** - How to contribute to the codebase
6. **Troubleshooting Guide** - Common issues and solutions

---

## 📝 Documentation Standards

### File Naming
- Use `SCREAMING_SNAKE_CASE.md` for documentation files
- Use descriptive names that indicate content
- Prefix with category when helpful (e.g., `NODE_DATA_FLOW_*`)

### Document Structure
- Start with title and metadata (date, audience, status)
- Include table of contents for long documents
- Use clear section headers
- Include code examples where relevant
- Add "Related Files" section at the end

### Markdown Style
- Use `#` for title, `##` for sections, `###` for subsections
- Use tables for structured data
- Use code blocks with language tags
- Use callouts for important notes (> **Note:** ...)
- Include diagrams where helpful (Mermaid, ASCII art)

---

## 🤝 Contributing to Documentation

1. **Keep it current**: Update docs when you change code
2. **Be specific**: Include file paths, line numbers, code examples
3. **Think about the reader**: Who will read this? What do they need to know?
4. **Archive old docs**: Don't delete, move to archive with reason
5. **Link related docs**: Help readers navigate between related topics

---

## 📞 Questions?

If you can't find what you're looking for:
1. Check the [GLOBAL_ROADMAP.md](./GLOBAL_ROADMAP.md) for file locations
2. Search the codebase for relevant keywords
3. Ask in the engineering Slack channel
4. Create a documentation issue if something is missing

---

**Maintained by:** Engineering Team  
**Last Review:** April 3, 2026  
**Next Review:** July 3, 2026 (quarterly)
