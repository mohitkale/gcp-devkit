---
name: cloud-run-deploy
description: Scaffold everything needed to deploy a service to Cloud Run. Use when the user asks to deploy an app to Cloud Run, containerize for Cloud Run, or wants a production-ready service.yaml with concurrency, min and max instances, CPU limits, and a dedicated service account.
argument-hint: "<language or framework and region>"
allowed-tools: Read Write Edit Glob
---

# Scaffold a Cloud Run deployment

Generate a Cloud Run `service.yaml`, a production-ready `Dockerfile`, and the exact `gcloud` command to deploy them.

## Inputs

`$ARGUMENTS` is a description of the app and target. Examples:

- `node api in us-central1`
- `python fastapi in europe-west1`
- `go worker, internal only`

If the language or region is missing, ask for:

- Language and framework.
- Region. Default to `us-central1` if the user has no preference.
- Expected request concurrency per instance (default 80).
- Whether the service must be reachable from the public internet or internal only.
- The name of the runtime service account, or confirm you should create one.

## Detection (when no argument is given)

Use Glob on the project root to detect the language. See the gcloud-debug skill for language hints. If multiple are present, ask which to target.

## Required output

Every deployment must include:

1. **`Dockerfile`**: multi-stage, pinned base images, non-root user, binds to `0.0.0.0:$PORT`.
2. **`service.yaml`**: a Cloud Run v1 Knative-style manifest. Includes `runtimeClassName` omitted, CPU and memory limits, `containerConcurrency`, `minScale`, `maxScale`, a dedicated service account, and a startup probe.
3. **Deploy command**: a `gcloud run services replace` call that applies the manifest, plus a separate `gcloud run services add-iam-policy-binding` if public access is needed.
4. **A short note on first-time setup**: the service account to create, the APIs to enable, and the Artifact Registry repo to create.

Image tags must be immutable (a specific version or a digest). Never `latest`.

## Output steps

1. State the files you will write.
2. Write the `Dockerfile` and the `service.yaml`.
3. Print the one-time setup commands.
4. Print the deploy command.
5. Print the verification commands.

## Example: Node.js API on Cloud Run

File `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20.12-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .
USER app
EXPOSE 8080
CMD ["node", "server.js"]
```

File `service.yaml`:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: api
  labels:
    cloud.googleapis.com/location: us-central1
  annotations:
    run.googleapis.com/ingress: internal-and-cloud-load-balancing
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "10"
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/startup-cpu-boost: "true"
    spec:
      serviceAccountName: api-runtime@PROJECT_ID.iam.gserviceaccount.com
      containerConcurrency: 80
      timeoutSeconds: 60
      containers:
        - name: api
          image: us-central1-docker.pkg.dev/PROJECT_ID/app/api:1.0.0
          ports:
            - name: http1
              containerPort: 8080
          env:
            - name: NODE_ENV
              value: production
          resources:
            limits:
              cpu: "1"
              memory: 512Mi
          startupProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 2
            timeoutSeconds: 2
            periodSeconds: 5
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            timeoutSeconds: 2
            periodSeconds: 30
            failureThreshold: 3
  traffic:
    - percent: 100
      latestRevision: true
```

One-time setup (run once per project):

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

gcloud artifacts repositories create app \
  --repository-format=docker \
  --location=us-central1

gcloud iam service-accounts create api-runtime \
  --display-name="Runtime SA for api Cloud Run service"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:api-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/logging.logWriter

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:api-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/monitoring.metricWriter
```

Build and push the image. Pin the tag to the git SHA or a semver version:

```bash
TAG=1.0.0
docker build -t us-central1-docker.pkg.dev/PROJECT_ID/app/api:$TAG .
docker push us-central1-docker.pkg.dev/PROJECT_ID/app/api:$TAG
```

Deploy by applying the manifest:

```bash
gcloud run services replace service.yaml --region us-central1
```

Verify:

```bash
gcloud run services describe api --region us-central1 --format='value(status.url)'
gcloud run revisions list --service api --region us-central1 --limit 3
```

If the service must be reachable from the public internet:

```bash
gcloud run services add-iam-policy-binding api \
  --region us-central1 \
  --member=allUsers \
  --role=roles/run.invoker
```

For internal-only services, do not add `allUsers`. Keep the ingress annotation `internal-and-cloud-load-balancing` and call the service from other GCP workloads or through a load balancer.

## Notes on the manifest

- `containerConcurrency: 80` is Cloud Run's default. Lower it for CPU-bound workloads. Raise it for I/O-bound workloads that spend most of their time waiting.
- `minScale: "1"` keeps one instance warm. Remove or set to `"0"` for low-traffic services to save money.
- `cpu-throttling: "false"` keeps CPU allocated between requests. Needed for background tasks and long-lived connections.
- `startup-cpu-boost: "true"` gives extra CPU during startup. Helps with cold start latency.
- `timeoutSeconds: 60` is conservative. Raise up to 3600 for long-running requests.

## Do not

- Do not deploy to Cloud Run from this skill. The user runs the deploy command.
- Do not write `PROJECT_ID` as a placeholder that looks like a real value. Either substitute the real project id the user gives you, or keep it as the literal token `PROJECT_ID` and tell the user to replace it.
- Do not use `gcloud run deploy` with `--source` in the generated command. The manifest approach is reproducible and checks into git.
- Do not grant `allUsers` invoker access on services that were not requested to be public.
- Do not use `latest` for the container image tag.
