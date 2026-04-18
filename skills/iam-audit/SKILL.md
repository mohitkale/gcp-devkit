---
name: iam-audit
description: Audit IAM bindings on a GCP project for overly broad roles and stale service account keys. Use when the user asks to review IAM on a project, find who has owner or editor, find unused service account keys, or assess the least-privilege posture of a GCP project before a security review.
argument-hint: "[project-id]"
allowed-tools: Bash(gcloud projects get-iam-policy *) Bash(gcloud iam roles list *) Bash(gcloud iam roles describe *) Bash(gcloud iam service-accounts list *) Bash(gcloud iam service-accounts describe *) Bash(gcloud iam service-accounts keys list *) Bash(gcloud logging read *) Bash(gcloud config get-value *) Read Grep
---

# Audit GCP IAM

Review project IAM bindings and service account keys. Flag roles and bindings that violate least privilege.

## Inputs

`$ARGUMENTS` is the GCP project id. If empty, run:

```bash
gcloud config get-value project
```

and confirm with the user before continuing.

## Workflow

### Step 1: pull the project IAM policy

```bash
gcloud projects get-iam-policy <project-id> \
  --format=json > iam-policy.json
```

Read the file and index bindings by role, then by member.

### Step 2: flag broad roles

For each binding, check the role. Red flags:

- **`roles/owner`** on any member other than a known human admin group. Owner can grant any role to any identity, including itself.
- **`roles/editor`** on a service account. Editor can read and write most resources in the project.
- **`roles/iam.securityAdmin`** or **`roles/resourcemanager.projectIamAdmin`** on anything other than a dedicated break-glass identity.
- **`roles/iam.serviceAccountUser`** or **`roles/iam.serviceAccountTokenCreator`** at the project level. These let the member impersonate every service account in the project. Grant them on a specific service account, not project-wide.
- **Custom roles** that include wildcard permissions like `*.setIamPolicy`, `*.actAs`, or `iam.*`.

### Step 3: flag risky members

- `allUsers` or `allAuthenticatedUsers` bound to anything other than public-readable resources. These grant access to the entire internet.
- External Google accounts (`user:someone@gmail.com`) on production projects when SSO exists.
- Default service accounts used outside of their intended scope:
  - `<project-number>-compute@developer.gserviceaccount.com` (Compute default SA) with roles beyond `roles/logging.logWriter` and `roles/monitoring.metricWriter`.
  - `<project-number>@cloudservices.gserviceaccount.com` with non-default roles.

### Step 4: audit custom roles

```bash
gcloud iam roles list --project <project-id> --format json
```

For each custom role:

- Read the list of permissions.
- Flag any permission ending in `.setIamPolicy`, `.actAs`, or any wildcard.
- Flag roles that duplicate a predefined role (the user should use the predefined role).

### Step 5: audit service account keys

```bash
gcloud iam service-accounts list --project <project-id> --format json
```

For each service account, list its keys:

```bash
gcloud iam service-accounts keys list \
  --iam-account=<sa-email> \
  --managed-by=user \
  --format=json
```

Flag:

- Any user-managed key older than 90 days.
- Service accounts with more than one user-managed key.
- Service accounts with a user-managed key that could use Workload Identity Federation instead (a key tied to a workload running on GKE, Cloud Run, GitHub Actions, or another supported platform).

Do not list keys with `--managed-by=system`. Those are rotated by Google.

### Step 6: cross-reference with Cloud Audit Logs (optional)

If the user has audit logs, check for service accounts that have not authenticated in the last 90 days:

```bash
gcloud logging read 'protoPayload.authenticationInfo.principalEmail="<sa-email>"' \
  --project <project-id> --limit 1 --freshness 90d
```

An empty result is strong evidence the account and its keys are unused.

## Output

Group findings by severity. Each finding has the binding, the concrete risk, and a concrete fix.

```
Project: <project-id>

## Critical

- <member> has <role> at project scope. Risk: <what they can do that they should not>. Fix: <replacement role or removal command>.

## High

- <...>

## Medium

- <...>

## Info

- <N> service accounts with unused keys older than 90 days.
```

For each finding, include the exact command the user must run to fix it. Do not run it yourself.

## Example findings

**Critical**: the service account `ci-runner@my-project.iam.gserviceaccount.com` has `roles/owner` at the project level. A compromise of this account would give an attacker full control of the project, including the ability to exfiltrate data from every bucket and delete every resource.

Fix: replace with the specific roles CI actually needs. Common minimum set for CI running container builds and deploys:

```bash
gcloud projects remove-iam-policy-binding my-project \
  --member=serviceAccount:ci-runner@my-project.iam.gserviceaccount.com \
  --role=roles/owner

gcloud projects add-iam-policy-binding my-project \
  --member=serviceAccount:ci-runner@my-project.iam.gserviceaccount.com \
  --role=roles/artifactregistry.writer

gcloud projects add-iam-policy-binding my-project \
  --member=serviceAccount:ci-runner@my-project.iam.gserviceaccount.com \
  --role=roles/run.admin

gcloud projects add-iam-policy-binding my-project \
  --member=serviceAccount:ci-runner@my-project.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser
```

The last role is scoped below to only the runtime service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  api-runtime@my-project.iam.gserviceaccount.com \
  --member=serviceAccount:ci-runner@my-project.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser
```

**High**: `allUsers` is bound to `roles/storage.objectViewer` at the project level. Every bucket in the project is world-readable.

Fix: remove the binding. If a single bucket should be public, set uniform bucket-level access and bind the role on that bucket only.

```bash
gcloud projects remove-iam-policy-binding my-project \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

**High**: service account `data-export@my-project.iam.gserviceaccount.com` has two user-managed keys. The oldest is 412 days old.

Fix: delete the old key and rotate the workload to Workload Identity Federation if it runs on a supported platform.

```bash
gcloud iam service-accounts keys delete <key-id> \
  --iam-account=data-export@my-project.iam.gserviceaccount.com
```

## Common fixes

- Replace `roles/owner` with a scoped set of specific roles.
- Replace `roles/editor` on a service account with only the resource types it actually writes.
- Move `roles/iam.serviceAccountUser` from project scope to a single service account resource.
- Convert a custom role with wildcards into a curated list of permissions.
- Delete user-managed keys and switch to Workload Identity or Workload Identity Federation.

## Reference

When flagging a broad predefined role, consult `reference/iam-common-roles.md` in the plugin root for narrower alternatives. It is a tiered catalog (basic roles, cross-project, service-specific admin, viewer) with risk ratings, recommended replacements, and a custom-role template. Read on-demand only when suggesting a fix.

## Do not

- Do not modify any binding yourself. The audit is read-only. Only propose the commands and let the user run them.
- Do not print the contents of any `gcloud iam service-accounts keys create` output or any key file the user references.
- Do not flag every role as critical. Calibrate severity: data exfiltration and IAM self-escalation are critical, read access to non-sensitive resources is info.
- Do not list keys with `--managed-by=system`. Those are Google-managed and cannot be rotated by the user.
