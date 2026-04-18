# GCP predefined IAM roles, risk tiers, and least-privilege alternatives

Fast lookup for GCP predefined roles the `iam-audit` skill commonly flags. Each entry lists permissions, why it is risky at project or organization scope, and the narrower role that usually covers the same workload.

Read this file from `iam-audit` only when a flagged binding needs a concrete alternative.

## Tier 1: basic roles (always flag)

Google explicitly recommends against these in production.

### roles/owner

- **Permissions**: full control, including IAM changes.
- **Why flag**: can grant itself or others any role. Full project compromise potential.
- **Common misuse**: applied to human users for convenience, never cleaned up.
- **Alternative**: combinations of predefined roles scoped to specific resources (for a typical "project admin" pattern, give `roles/resourcemanager.projectIamAdmin` + `roles/serviceusage.serviceUsageAdmin` + specific service admin roles).

### roles/editor

- **Permissions**: read and modify all resources, cannot change IAM.
- **Why flag**: can delete production resources. Can read storage buckets, Cloud SQL, Firestore.
- **Alternative**: service-specific admin roles (`roles/run.admin`, `roles/storage.admin`, `roles/container.admin`). Pick the one the workload actually needs.

### roles/viewer

- **Permissions**: read all resources.
- **Quiet risk**: reads all data in Cloud Storage, BigQuery tables, Cloud SQL metadata, Secret Manager secret names.
- **Alternative**: `roles/browser` for directory-style navigation without data reads, or specific viewer roles (`roles/run.viewer`, `roles/storage.objectViewer`).

## Tier 2: cross-project / org-level roles

These are powerful in any scope that touches multiple projects.

### roles/resourcemanager.organizationAdmin

Complete control over the organization. Assign only to break-glass accounts with MFA and alerting.

### roles/iam.organizationRoleAdmin

Can create custom roles at the organization level. Dangerous because a custom role can bundle powerful permissions with an innocuous name.

### roles/billing.admin

Can change billing account and link/unlink projects. A compromised principal with this role can redirect your spend.

### roles/resourcemanager.projectCreator / projectDeleter

Project creator is usually fine. Project deleter is rarely needed; delete operations should go through approved process.

## Tier 3: service-specific roles (flag only if scope is wrong)

These are fine when scoped to a specific resource; flag when applied at project or higher.

### Cloud Run

- **roles/run.admin**: full control over Cloud Run services and revisions.
- **roles/run.developer**: create and manage services, cannot set IAM on them.
- **roles/run.invoker**: call a Cloud Run service. This is the one to give other services for service-to-service calls.
- **roles/run.viewer**: read service metadata.

Flag pattern: `run.admin` at project scope on a runtime service account. Service accounts that *run* Cloud Run services do not need `run.admin`; they need whatever *the code* needs (e.g. `roles/pubsub.subscriber` if the service reads from Pub/Sub).

### GKE

- **roles/container.admin**: full cluster admin via Kubernetes RBAC.
- **roles/container.developer**: manage workloads but not cluster resources.
- **roles/container.clusterAdmin**: create and delete clusters (not workloads).
- **roles/container.hostServiceAgentUser**: used by the GKE service agent for VPC host projects.

### Cloud Storage

- **roles/storage.admin**: all buckets and objects. Flag at project scope; only OK on a specific bucket.
- **roles/storage.objectAdmin**: objects in specific buckets.
- **roles/storage.objectViewer**: read objects.
- **roles/storage.objectCreator**: write objects, cannot delete.

Typical least-privilege split: one account with `objectCreator`, one with `objectViewer`. Never `storage.admin` on a service account.

### Pub/Sub

- **roles/pubsub.admin**: full control. Rarely needed by runtime identities.
- **roles/pubsub.publisher**: publish to a topic.
- **roles/pubsub.subscriber**: pull and ack messages.
- **roles/pubsub.viewer**: read metadata only.

Typical pattern: publisher on a topic, subscriber on a subscription. Grant at the topic or subscription scope, not project.

### Cloud SQL

- **roles/cloudsql.admin**: full control.
- **roles/cloudsql.editor**: manage instances but not IAM.
- **roles/cloudsql.client**: connect to instances (for Cloud SQL Proxy and IAM DB auth).
- **roles/cloudsql.instanceUser**: IAM database authentication user.

For Cloud Run or GKE workloads that connect to Cloud SQL, grant `roles/cloudsql.client` on the specific instance.

### Secret Manager

- **roles/secretmanager.admin**: all secrets. Rarely needed.
- **roles/secretmanager.secretAccessor**: read secret payload. Grant on the specific secret.
- **roles/secretmanager.secretVersionManager**: rotate versions.

Accessors are the common runtime role. Scope to a specific secret resource, not the project.

### IAM-related service roles

- **roles/iam.serviceAccountUser**: lets the principal impersonate a service account. Flag at project scope; this is how privilege escalation happens.
- **roles/iam.serviceAccountTokenCreator**: create OAuth and OIDC tokens for other service accounts. Extremely sensitive.
- **roles/iam.serviceAccountAdmin**: manage service accounts. Flag at project.

## Tier 4: read-only roles

Generally safe.

- **roles/logging.viewer**: read Cloud Logging.
- **roles/monitoring.viewer**: read Cloud Monitoring.
- **roles/errorreporting.viewer**: read Error Reporting.

## Custom role template

When predefined roles do not fit, recommend a custom role:

```bash
gcloud iam roles create customAppRuntime \
  --project=<project-id> \
  --title="App runtime role" \
  --description="Minimal role for the app runtime service account." \
  --permissions=pubsub.subscriptions.consume,secretmanager.versions.access,logging.logEntries.create \
  --stage=GA
```

Grant with `gcloud projects add-iam-policy-binding <project-id> --member=serviceAccount:<sa-email> --role=projects/<project-id>/roles/customAppRuntime`.

## Stale service account keys

User-managed service account keys (JSON key files) are the most common credential theft vector on GCP. Flag any key older than 90 days; rotate or remove. Prefer Workload Identity (GKE) or IAM impersonation for GCE/Cloud Run where possible.

```bash
gcloud iam service-accounts keys list --iam-account=<sa-email>
```

## Cross-project IAM

A service account in project A can be granted permissions in project B. These bindings are easy to miss because they live in project B's policy, not the service account's home project. Audit bindings by principal across all projects you have access to:

```bash
for p in $(gcloud projects list --format="value(projectId)"); do
  gcloud projects get-iam-policy "$p" --filter="bindings.members:serviceAccount:<sa-email>" --flatten="bindings[].members" --format="table(bindings.role, bindings.members)"
done
```
