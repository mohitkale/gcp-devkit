# GCP DevKit

A Claude Code plugin that helps you write Terraform for Google Cloud, debug Cloud Run, GKE, and Cloud Functions failures, audit IAM, and scaffold Cloud Run deployments.

## What it does

- Diagnoses Cloud Run cold starts, 500s, and revision failures.
- Investigates GKE pod errors and Cloud Functions deployment or runtime errors.
- Generates idiomatic Terraform for Cloud Run, GCS, Cloud SQL, Pub/Sub, Artifact Registry, and service accounts.
- Audits project IAM for broad roles and unused service account keys.
- Scaffolds a Cloud Run `service.yaml`, a Dockerfile, and the `gcloud` deploy command.
- Generates GKE manifests that use Workload Identity, BackendConfig, and Google-managed certs.
- Generates or audits Firestore security rules and flags open access patterns.

## Example

```
> /gcp-devkit:terraform-gcp cloud run service named api in us-central1

Will write: versions.tf, providers.tf, variables.tf, outputs.tf, main.tf.
Each file follows project conventions: hashicorp/google pinned to ~> 5.20,
private ingress, a least-privilege runtime service account, and labels
for environment and owner.
Validate locally with:
  terraform fmt -recursive && terraform init -backend=false && terraform validate
```

## Installation

From the Anthropic plugin marketplace:

```
/plugin install gcp-devkit
```

To install from a local directory for development:

```
claude --plugin-dir ./gcp-devkit
```

## Commands

All commands are invoked from inside Claude Code with `/gcp-devkit:<command>`.

| Command | What it does | Example |
|---|---|---|
| `/gcp-devkit:doctor` | Check the local GCP toolchain (gcloud, terraform, kubectl). Runs real diagnostic commands, not a prompt. | `/gcp-devkit:doctor` |
| `/gcp-devkit:project` | Show the active project, its state, and every project the account can access. Read-only. | `/gcp-devkit:project` |
| `/gcp-devkit:full-audit` | One-shot full audit: doctor + project + iam-audit (chained). Opt-in only. | `/gcp-devkit:full-audit my-project` |
| `/gcp-devkit:gcloud-debug` | Diagnose Cloud Run, GKE, or Cloud Functions failures. | `/gcp-devkit:gcloud-debug api service in us-central1` |
| `/gcp-devkit:terraform-gcp` | Generate Terraform for common GCP resources. | `/gcp-devkit:terraform-gcp cloud run service named api` |
| `/gcp-devkit:iam-audit` | Audit project IAM for broad roles and stale keys. | `/gcp-devkit:iam-audit my-project` |
| `/gcp-devkit:cloud-run-deploy` | Scaffold a Cloud Run service.yaml, Dockerfile, and deploy command. | `/gcp-devkit:cloud-run-deploy node api in us-central1` |
| `/gcp-devkit:gke-manifest` | Generate GKE manifests with Workload Identity. | `/gcp-devkit:gke-manifest api behind managed cert at api.example.com` |
| `/gcp-devkit:firestore-rules` | Generate or audit Firestore security rules. | `/gcp-devkit:firestore-rules audit firestore.rules` |

## Agents

The plugin ships with three subagents that Claude may delegate to automatically when the work fits:

- **gcp-forensics**: specialized Cloud Run, GKE, and Cloud Functions failure diagnosis.
- **terraform-author**: specialized Terraform writer for GCP resources.
- **migration-planner**: opt-in specialist for multi-step cloud-to-GCP migration planning. Invoked only when the user explicitly asks to plan a migration from AWS or Azure. Does not fire on routine requests.

You can also invoke an agent explicitly, for example:

```
Ask the gcp-forensics agent why my Cloud Run revision is returning 500s.
```

## Hooks

On session start, the plugin runs a small Node.js script that inspects the current working directory for GCP artefacts. If it finds `.tf` files that use the `hashicorp/google` provider, `service.yaml`, `cloudbuild.yaml`, `app.yaml`, `firestore.rules`, or `.gcloudignore`, it injects a one-line context note so Claude knows which skills apply without the user having to say so. The hook is silent if nothing matches.

A second hook fires **after every Bash tool call** (`PostToolUse`). It watches for `terraform apply`, `gcloud run deploy`, `gcloud projects add-iam-policy-binding`, and similar state-changing commands, and injects a short follow-up note: what to verify, which skill to run for diagnosis.

Both hooks require Node.js on `PATH`. Without Node, they quietly no-op and every skill and command still works.

## Reference files

A `reference/` directory ships deeper knowledge that skills read only when they need it.

- `reference/iam-common-roles.md` is a tiered catalog of GCP predefined roles (basic roles, cross-project, service-specific admin, viewer) with risk ratings, common misuses, and narrower alternatives plus a custom-role template. The `iam-audit` skill reads this when it flags a binding and needs to suggest a narrower role.

## Requirements

- Claude Code v2.0 or later.
- Node.js on `PATH` for SessionStart and PostToolUse hooks (any current LTS). If Node is missing, hooks no-op silently; skills and commands still work.
- `gcloud` CLI installed, on `PATH`, and authenticated with a project set (`gcloud auth login`, `gcloud config set project <id>`).
- For Terraform generation: `terraform` v1.5 or later recommended for running `terraform fmt` and `terraform validate` on the output.
- For Firestore rules audit: no runtime dependency. The review reads rule files without deploying them.

## Safety

All commands follow these rules:

1. Destructive operations (`gcloud run services delete`, `gcloud container clusters delete`, `gcloud iam service-accounts keys delete`, `terraform apply`, `terraform destroy`) always require explicit user confirmation. They are never part of the default command workflow.
2. Read-only commands (`gcloud logging read`, `gcloud run services describe`, `gcloud projects get-iam-policy`) run without prompting because they are safe.
3. The plugin never prints secret values from service account keys, Secret Manager, or environment variables.
4. File writes are announced before they happen so the user can stop them.
5. IAM changes are never applied by the plugin. The plugin only proposes the new binding and the command to run.

## Known limitations

- `iam-audit` reports current bindings. It does not correlate with audit logs to tell you whether a broad role is actually being used.
- `terraform-gcp` generates HCL and stops at `terraform validate`. The plugin never runs `terraform apply` or `terraform destroy`.
- `firestore-rules` performs a static review. It does not run the Firestore emulator to test rules against a sample dataset.
- `gke-manifest` assumes the cluster has Workload Identity enabled on a registered identity pool. Standard GKE clusters without Workload Identity will need separate service account keys.
- Version 1.0 does not cover Cloud Build triggers, Cloud Deploy pipelines, BigQuery infrastructure, or Vertex AI resources beyond the basics.

## Development

To iterate locally on the plugin itself:

```
claude --plugin-dir ./gcp-devkit
```

Validate the plugin structure:

```
claude plugin validate ./gcp-devkit
```

## License

MIT. See `LICENSE`.
