---
description: Run the full GCP audit pass in one command. Chains doctor, project, and iam-audit into a single report. Use as a pre-release or pre-handoff check to surface environment, project, and IAM findings in one pass.
argument-hint: "[project-id]"
allowed-tools: Bash(gcloud version *) Bash(gcloud auth list *) Bash(gcloud config list *) Bash(gcloud config get-value *) Bash(gcloud projects describe *) Bash(gcloud projects list *) Bash(gcloud projects get-iam-policy *) Bash(gcloud iam service-accounts list *) Bash(gcloud iam service-accounts keys list *) Bash(terraform version *) Bash(kubectl version *) Bash(kubectl config *) Read
---

# Full GCP audit

Run the plugin's audit-flavored skills in sequence and produce one combined report. This is the "do everything" command. Use only when explicitly asked.

## Inputs

`$ARGUMENTS` takes an optional project ID to audit. Defaults to `gcloud config get-value core/project`. Does NOT switch active project.

## Workflow

Run each step. If a step fails, note it and continue.

### Step 1: Environment check (from `doctor`)

Same as `/gcp-devkit:doctor`. Report gcloud, components, terraform, kubectl versions.

### Step 2: Project info (from `project`)

Same as `/gcp-devkit:project`. Report active account, active project, region/zone, lifecycle state, accessible projects list.

### Step 3: IAM audit (from `iam-audit`)

Same as `/gcp-devkit:iam-audit <project-id>`. Report:

- Principals with basic roles (`roles/owner`, `roles/editor`, `roles/viewer`) at project scope
- Service accounts with keys older than 90 days
- Cross-project bindings (service accounts granted access from outside the project)
- Custom roles with wildcard permissions

Cross-reference findings against `reference/iam-common-roles.md` for narrower role suggestions.

## Output format

```
GCP full audit
==============
Project: contoso-prod-123        Account: jane.doe@contoso.com

Environment
-----------
gcloud:          490.0.0 (components: kubectl, gke-gcloud-auth-plugin)
Terraform:       1.9.5 (detected in cwd)
kubectl:         v1.30.2 (context: gke_contoso-prod-123_us-central1_prod)

Project
-------
Project ID:       contoso-prod-123
Name:             Contoso Production
State:            ACTIVE
Region / Zone:    us-central1 / us-central1-a

IAM findings
============
Critical (2):
- sa-github-deployer@contoso-prod-123.iam.gserviceaccount.com has roles/owner at project scope.
  Suggest: roles/run.admin + roles/artifactregistry.admin + roles/secretmanager.admin scoped to specific resources.
- 3 user-managed keys for sa-legacy-app older than 365 days. Rotate or migrate to workload identity.

High (3):
- 2 principals have roles/editor at project scope (both human users)
- sa-migration-temp has roles/editor, last authenticated 2025-11-10 (stale)
- Custom role "SuperPowers" grants *.* on all services. Used by 1 principal.

Medium (2):
- 8 principals have roles/viewer at project scope (reads all Cloud Storage and BigQuery)
- 2 cross-project bindings: sa-central-ops@ops-project has roles/iam.serviceAccountUser here

Suggested next steps
--------------------
1. Revoke roles/owner from sa-github-deployer. Propose narrower service-specific admin roles.
2. Rotate 3 user-managed keys older than 365 days.
3. Remove sa-migration-temp if confirmed unused.

Reference
---------
For narrower alternatives to flagged roles, see `reference/iam-common-roles.md` in this plugin.
```

If no concerns:

```
GCP full audit
==============
Project: contoso-prod-123

Nothing of concern found. No basic roles at project scope, no stale service account keys over 90 days, all custom roles have explicit permission lists.
```

## Do not

- Do not run state-changing commands (`gcloud * add-iam-policy-binding`, `gcloud iam service-accounts keys delete`).
- Do not switch active project with `gcloud config set project`. Audit the one named in `$ARGUMENTS` by passing `--project` per call.
- Do not include the full output of each skill. Keep the combined report under 80 lines.
- Do not enumerate all projects and audit each one. This command audits one project at a time. If the user wants multi-project, they invoke it per project.
