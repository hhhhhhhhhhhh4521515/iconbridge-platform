# Architecture decision records

Each record gives the context, the decision and its consequences. All are accepted; later changes are added to the record itself under "Later changes".

| ADR                                                    | Decision                                                                 | Area           |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | -------------- |
| [001](ADR-001-stack-choice.md)                         | Stack: pnpm + Turborepo, NestJS, Next.js, Prisma, PostgreSQL, zod shared | Foundation     |
| [002](ADR-002-data-model.md)                           | Data model conventions and passport encryption                           | Data           |
| [003](ADR-003-authentication.md)                       | Authentication, sessions and access control                              | Security       |
| [004](ADR-004-job-search-and-media.md)                 | Job search, availability and public media                                | Product        |
| [005](ADR-005-candidate-documents-and-applications.md) | Candidate documents, the re-application rule and erasure                 | Product        |
| [006](ADR-006-back-office-and-scheduled-tasks.md)      | Back office, exports and scheduled tasks                                 | Product        |
| [007](ADR-007-public-web.md)                           | Public web application                                                   | Web            |
| [008](ADR-008-candidate-area.md)                       | Candidate area of the web application                                    | Web            |
| [009](ADR-009-back-office.md)                          | Back office of the web application                                       | Web            |
| [010](ADR-010-historical-results-and-deletions.md)     | Historical results, and deleting candidates and applications             | Product        |
| [011](ADR-011-security-hardening-and-qa.md)            | Security hardening, email outbox, cache invalidation, browser test stack | Security, QA   |
| [012](ADR-012-container-images.md)                     | Container images                                                         | Delivery       |
| [013](ADR-013-azure-infrastructure.md)                 | Azure infrastructure on a student subscription                           | Infrastructure |
| [014](ADR-014-email-azure-communication-services.md)   | Production email through Azure Communication Services                    | Infrastructure |
| [015](ADR-015-container-apps-environment-mode.md)      | Container Apps environment created with an explicit mode                 | Infrastructure |
| [016](ADR-016-country-combobox.md)                     | Country fields are searchable comboboxes                                 | Web            |
| [017](ADR-017-cold-start.md)                           | Shorter cold starts without a warm replica                               | Infrastructure |
| [018](ADR-018-ci-cd.md)                                | CI/CD with GitHub Actions and federated Azure identities                 | Delivery       |
| [019](ADR-019-observability-and-alerts.md)             | Observability and alerts within the student budget                       | Operations     |
| [020](ADR-020-backups.md)                              | Database backups and restore                                             | Operations     |
| [021](ADR-021-cooldown-waiver.md)                      | Lifting the re-application waiting period                                | Product        |
| [022](ADR-022-warm-replicas.md)                        | One warm replica for the web app and the API (40 USD budget)             | Infrastructure |
