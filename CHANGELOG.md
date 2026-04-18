# Changelog

All notable changes to this plugin are documented here.

The format is based on Keep a Changelog, and this plugin uses semantic versioning.

## [1.0.0] - 2026-04-18

### Added

- Initial release.
- Skill `gcloud-debug`: diagnose Cloud Run, GKE, and Cloud Functions failures.
- Skill `terraform-gcp`: generate idiomatic Terraform for common GCP resources.
- Skill `iam-audit`: audit project IAM bindings for overly broad roles and stale keys.
- Skill `cloud-run-deploy`: scaffold Cloud Run service.yaml, Dockerfile, and deploy command.
- Skill `gke-manifest`: generate GKE-tailored manifests with Workload Identity and managed certs.
- Skill `firestore-rules`: generate or audit Firestore security rules.
- Agent `gcp-forensics`: specialized GCP failure diagnosis.
- Agent `terraform-author`: specialized Terraform writer for GCP.
- Command `doctor`: real toolchain check. Reports gcloud version, active account, active project and region, terraform version, and kubectl context if GKE is in use.
- Hook `session-start`: Node.js detector that inspects cwd for `.tf` files using `hashicorp/google`, `service.yaml`, `cloudbuild.yaml`, `app.yaml`, `firestore.rules`, or `.gcloudignore`. Injects a one-line context note so Claude knows which skills apply.
- Command `project`: read-only project report. Shows active account, active project and its lifecycle state, default region and zone, and all accessible projects.
- Hook `post-tool-use`: PostToolUse hook that reacts to `terraform plan/apply`, `gcloud run deploy`, `gcloud container clusters create/delete`, `gcloud projects add-iam-policy-binding`, and similar state-changing commands.
- Tests: `tests/run.js` with fixture directories that invoke the SessionStart hook against synthetic cwds and assert expected output.
- CI: `.github/workflows/validate.yml` runs required-file checks, plugin.json parse, skill/agent/command frontmatter, hook script syntax, em-dash scan, and the hook fixture tests on every push and PR.
- Reference file `reference/iam-common-roles.md`: tiered catalog of GCP predefined roles (basic roles, cross-project, service-specific admin, viewer) with risk ratings, common misuses, narrower alternatives, and a custom-role template. Read by `iam-audit` on-demand only.
- Command `full-audit`: opt-in workflow command that chains doctor, project, and iam-audit into one combined report. Read-only.
- Agent `migration-planner`: opt-in specialist for multi-step cloud-to-GCP migration planning. Maps AWS and Azure services to GCP equivalents, produces a phased plan with explicit stage boundaries, and calls out risks specific to the workload. Invoked only on explicit migration-planning requests.
