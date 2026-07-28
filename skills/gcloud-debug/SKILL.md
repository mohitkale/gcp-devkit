---
name: gcloud-debug
description: Diagnose common GCP failures on Cloud Run, GKE, and Cloud Functions. Use when the user reports a Cloud Run cold start, 500 or 503 responses, a revision that will not serve traffic, a GKE pod in CrashLoopBackOff or ImagePullBackOff, a Cloud Functions deployment error, or a Cloud Functions runtime error. Shows the exact gcloud commands to pull logs and metrics.
argument-hint: "[service-name or resource-id and region]"
allowed-tools: Bash(gcloud logging read *) Bash(gcloud run services describe *) Bash(gcloud run revisions list *) Bash(gcloud run revisions describe *) Bash(gcloud functions describe *) Bash(gcloud container clusters describe *) Bash(gcloud projects describe *) Bash(gcloud config get-value *) Read Grep
---

# Diagnose GCP failures

Find the root cause of a Cloud Run, GKE, or Cloud Functions failure and suggest a concrete fix.

## Inputs

`$ARGUMENTS` is optional context: a service name, a revision id, a pod name and namespace, a function name, and the region. If empty, ask the user which resource is failing and in which region and project.

Before running any command, confirm the active project:

```bash
gcloud projects describe $(gcloud config get-value project)
```

## Detection steps

### Cloud Run: cold start or 5xx responses

1. Describe the service to see the active revision, min and max instances, and concurrency:

```bash
gcloud run services describe <service> --region <region> --format yaml
```

2. List recent revisions and find the one serving traffic:

```bash
gcloud run revisions list --service <service> --region <region> --limit 10
```

3. Pull the last 15 minutes of request logs and filter for 5xx:

```bash
gcloud logging read 'resource.type="cloud_run_revision"
resource.labels.service_name="<service>"
httpRequest.status>=500' \
  --limit 100 --freshness 15m --format json
```

4. Pull stderr for the revision (this is where unhandled exceptions go):

```bash
gcloud logging read 'resource.type="cloud_run_revision"
resource.labels.service_name="<service>"
severity>=ERROR' \
  --limit 100 --freshness 15m
```

5. Common Cloud Run failures and what to check:
   - **Cold start timeouts**: the container takes more than the startup probe allows. Set `minScale: 1` to keep one instance warm, or increase the container startup timeout with `--cpu-boost` and `--startup-cpu-boost`.
   - **502 with no stderr**: the container is not listening on `$PORT`. Cloud Run injects `PORT` (defaults to 8080). The app must bind to `0.0.0.0:$PORT`, not to `localhost` or a hard-coded port.
   - **503 "no available instances"**: `maxScale` is reached. Raise it, reduce concurrency, or fix a memory leak that prevents instances from recycling.
   - **500 with "Container failed to start"**: read `gcloud run revisions describe <revision>` for the exit reason. Typical causes are a crash before listening on `$PORT`, a missing env var, or an IAM denial reaching Secret Manager.
   - **Permission denied reaching a GCP API**: the runtime service account lacks the role. Do not use the default compute service account. Create a dedicated service account and grant only the roles needed.

### GKE: pod errors

1. Describe the cluster to confirm you are pointed at the right one:

```bash
gcloud container clusters describe <cluster> --region <region>
```

2. Pull pod state through the GKE control plane logs (no kubeconfig needed):

```bash
gcloud logging read 'resource.type="k8s_pod"
resource.labels.cluster_name="<cluster>"
resource.labels.namespace_name="<ns>"
resource.labels.pod_name="<pod>"' \
  --limit 100 --freshness 30m
```

3. Pull container stderr:

```bash
gcloud logging read 'resource.type="k8s_container"
resource.labels.cluster_name="<cluster>"
resource.labels.pod_name="<pod>"
severity>=ERROR' \
  --limit 100 --freshness 30m
```

4. Common GKE failures and what to check:
   - **ImagePullBackOff** from Artifact Registry: either the image tag is wrong, or the node pool service account lacks `roles/artifactregistry.reader` on the repo's project. Grant the role on the repo, not on the whole project.
   - **CrashLoopBackOff with exit 137**: OOMKilled. Raise the memory limit. On Autopilot, the request equals the limit, so raise `resources.requests.memory`.
   - **Workload Identity denial**: the Kubernetes service account is not annotated with `iam.gke.io/gcp-service-account`, or the GCP service account does not have `roles/iam.workloadIdentityUser` for the KSA. Check both sides.
   - **LoadBalancer stuck in `Pending`**: the VPC-native cluster needs a reserved external IP, or a firewall rule blocks the health check from `130.211.0.0/22` and `35.191.0.0/16`.
   - **BackendConfig not applied**: the Service is missing the annotation `cloud.google.com/backend-config`, or the BackendConfig name is wrong.

### Cloud Functions: deploy or runtime error

1. Describe the function to see the runtime, entry point, and last revision:

```bash
gcloud functions describe <function> --region <region> --gen2
```

2. Pull build logs (deploy failures) and runtime logs (500s):

```bash
gcloud logging read 'resource.type="cloud_function"
resource.labels.function_name="<function>"
severity>=WARNING' \
  --limit 100 --freshness 30m
```

3. Common Cloud Functions failures and what to check:
   - **Deployment fails with "Container Healthcheck failed"**: the code does not start a server or does not export the expected entry point. For gen2 HTTP functions, the function must respond within the configured startup time and the entry point name must match the export.
   - **Deployment fails with permission denied on Cloud Build or Artifact Registry**: the Cloud Build service account `<project-number>@cloudbuild.gserviceaccount.com` needs `roles/artifactregistry.writer` on the function's image repo. Gen2 uses Artifact Registry, not Container Registry.
   - **Runtime 500 with no error in logs**: the function timed out. Raise `--timeout` (max 540s for gen1, 3600s for gen2 HTTP) or move long work to a Pub/Sub triggered function with retries.
   - **"ENOMEM" or "out of memory"**: raise `--memory`. Defaults are low.
   - **Event was not delivered**: the Eventarc trigger's service account is missing `roles/eventarc.eventReceiver` or the Pub/Sub subscription has piled up unacked messages. Check the subscription backlog.

## Output

1. State the single most likely root cause in one short sentence.
2. Show the 3 to 10 lines of log output that prove it. Never paste secret values.
3. Give the concrete fix. If the fix is a gcloud command, show the full command with the flags needed.
4. If two causes are equally likely, list each with the one command that would confirm it.

## Example diagnosis

**Root cause**: the Cloud Run revision crashes on startup because the container is listening on port 3000 but Cloud Run sets `PORT=8080`.

**Evidence**:
```
resource.labels.service_name="api"
textPayload: "listening on http://0.0.0.0:3000"
... (no logs for /healthz from the load balancer)
revision status: Container failed to start. Failed to start and then listen on the port defined by the PORT environment variable.
```

**Fix**: bind to `process.env.PORT || 8080` in the app, or set `--port 3000` on the service if the app cannot be changed:

```bash
gcloud run services update api --region us-central1 --port 3000
```

**Next step**:
```bash
gcloud run revisions list --service api --region us-central1 --limit 3
gcloud logging read 'resource.labels.service_name="api" severity>=ERROR' --limit 20 --freshness 5m
```

## Do not

- Do not run destructive commands (`gcloud run services delete`, `gcloud container clusters delete`, `gcloud functions delete`, `gcloud logging sinks delete`) without asking the user first.
- Do not print secret values from `gcloud secrets versions access` output or from environment variables that look like tokens.
- Do not guess. If logs do not show the cause, say which log filter or describe field would reveal it.
