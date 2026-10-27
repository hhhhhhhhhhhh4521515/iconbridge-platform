# Documentation

Everything about IconBridge Jobs, from the specification to operations. The files are written to be used directly for the internship report; the table maps them to the usual chapters.

| Report chapter                   | Source                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Context and requirements         | [SPEC.md](SPEC.md): users, roles, features, business rules                                                       |
| Work environment and constraints | [00-environment.md](00-environment.md): workstation, Azure subscription, region, quotas, budget                  |
| Architecture                     | [ARCHITECTURE.md](ARCHITECTURE.md): C4 context and containers, data model, modules, Azure deployment             |
| Technical choices                | [adr/](adr/README.md): 21 decisions with their context and consequences                                          |
| Interfaces                       | [API.md](API.md): every operation and who may call it (generated)                                                |
| Security and personal data       | [SECURITY.md](SECURITY.md): OWASP checklist, passport encryption, GDPR, retention, dependencies, remaining risks |
| Quality                          | [QA-REPORT.md](QA-REPORT.md): tests, coverage, load tests, bugs found                                            |
| Deployment and CI/CD             | [DEPLOYMENT.md](DEPLOYMENT.md), [CICD.md](CICD.md)                                                               |
| Operations                       | [RUNBOOK.md](RUNBOOK.md): deploy, roll back, alerts, backups and restore (RPO/RTO), secrets, end of life         |
| User documentation               | [USER-GUIDE-CANDIDATE.md](USER-GUIDE-CANDIDATE.md), [USER-GUIDE-ADMIN.md](USER-GUIDE-ADMIN.md)                   |
| Planning and progress            | [TIMELINE.md](TIMELINE.md) (summary), [JOURNAL.md](JOURNAL.md) (every step with its checks and pull request)     |

Screenshots in [screenshots/](screenshots/) come from the local test environment with sample jobs and test accounts only (`apps/web/e2e/admin-guide-screenshots.spec.ts`); the repository is public and holds no real candidate data.
