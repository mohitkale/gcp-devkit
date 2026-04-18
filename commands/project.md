---
description: Show the active GCP project, its lifecycle state, and the projects the current account can access. Use before any operation that changes cloud state so the user confirms they are pointing at the right project. Does not change state.
allowed-tools: Bash(gcloud config list *) Bash(gcloud config get-value *) Bash(gcloud projects list *) Bash(gcloud projects describe *) Bash(gcloud auth list *)
---

# Show the active GCP project

Report the active account, active project, default region and zone, and the projects the account can access. Read-only. Use this before running `gcloud run deploy`, `terraform apply`, or any state-changing command.

## Steps

1. Active account:

```bash
gcloud auth list --format="value(account,status)"
```

If no account is ACTIVE, report that and suggest `gcloud auth login`.

2. Active project and default region:

```bash
gcloud config list --format=json
```

Parse the JSON for `core.project`, `compute.region`, `compute.zone`.

3. Project details and lifecycle state:

```bash
gcloud projects describe "$(gcloud config get-value core/project 2>/dev/null)" --format="value(projectId, name, projectNumber, lifecycleState)" 2>&1
```

If this fails with permission errors, the account cannot read the active project. Report that.

4. Projects the account can access (first 20):

```bash
gcloud projects list --format="table(projectId, name, projectNumber, lifecycleState)" --limit=20
```

## Output format

```
GCP identity
------------
Active account:   jane.doe@contoso.com (ACTIVE)

Active project
--------------
Project id:       contoso-prod-123
Name:             Contoso Production
Project number:   987654321098
State:            ACTIVE
Region:           us-central1
Zone:             us-central1-a

Accessible projects (12 total, showing first 20)
------------------------------------------------
PROJECT_ID               NAME                     NUMBER         STATE
contoso-prod-123         Contoso Production       987654321098   ACTIVE
contoso-staging-456      Contoso Staging          876543210987   ACTIVE
contoso-sandbox-789      Contoso Sandbox          765432109876   ACTIVE
...
```

End with: `To switch: gcloud config set project <PROJECT_ID>`. Do not run it automatically.

## Do not

- Do not run `gcloud config set project` or `gcloud auth login`. State changes are for the user to confirm.
- Do not print service account keys, Secret Manager values, or any credential material.
- Do not call `gcloud projects list` without `--limit` on accounts with thousands of projects (limit to 20 in the default flow).
