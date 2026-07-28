---
description: Check the local GCP toolchain. Reports gcloud version, active account, active project, default region, terraform version, and kubectl context if GKE is in use. Use before running any GCP skill to confirm the environment is ready.
allowed-tools: Bash(gcloud version *) Bash(gcloud auth list *) Bash(gcloud config list *) Bash(gcloud projects describe *) Bash(terraform version *) Bash(kubectl version *) Bash(kubectl config *)
---

# GCP environment check

Run a fixed diagnostic of the local GCP toolchain.

## Steps

1. gcloud installed and its components:

```bash
gcloud version 2>&1
```

If gcloud is missing, report that and stop. All skills in this plugin require gcloud.

2. Active account:

```bash
gcloud auth list --format="value(account,status)"
```

If no account is active, report the user as **not signed in** and suggest `gcloud auth login`.

3. Active configuration (project, region, zone):

```bash
gcloud config list --format=json
```

Parse the JSON and extract `core.project`, `compute.region`, `compute.zone`.

4. Project exists and the account has access:

```bash
gcloud projects describe "$(gcloud config get-value core/project 2>/dev/null)" --format="value(projectId,name,projectNumber,lifecycleState)" 2>&1
```

If this fails with a permission error, the account cannot read the project. Report that and suggest checking the IAM bindings.

5. Terraform version (only if any `.tf` files are present in cwd):

```bash
terraform version -json 2>&1
```

6. GKE / kubectl (only if the user is working with GKE):

```bash
kubectl config current-context 2>&1
kubectl version --client --output=yaml 2>&1 | head -10
```

## Output format

```
GCP environment
---------------
gcloud:          490.0.0, components: kubectl, gke-gcloud-auth-plugin
Active account:  someone@example.com (ACTIVE)
Project:         my-project (ACTIVE)
Region:          us-central1
Zone:            us-central1-a
Terraform:       1.9.5 (optional, detected from .tf files in cwd)
kubectl context: gke_my-project_us-central1_prod (optional)

Next steps: environment looks healthy. Try:
- /gcp-devkit:terraform-gcp <resource>
- /gcp-devkit:gcloud-debug cloud-run <service>
- /gcp-devkit:iam-audit
```

If any step fails, print the exact error and a one-line fix hint.

## Do not

- Do not print service account keys, Secret Manager values, or any credential contents.
- Do not run destructive verbs (`gcloud * delete`, `gcloud iam service-accounts keys delete`, `terraform apply`, `terraform destroy`).
- Do not change the active project with `gcloud config set`. Report the current one and let the user switch.
