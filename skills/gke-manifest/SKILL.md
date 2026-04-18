---
name: gke-manifest
description: Generate GKE-tailored Kubernetes manifests that use Workload Identity, BackendConfig, and Ingress with Google-managed certificates. Use when the user asks to deploy to GKE, set up Workload Identity for a workload, expose a service through a Google-managed certificate, or configure health checks and CDN through BackendConfig.
argument-hint: "<workload description>"
allowed-tools: Read Write Edit Glob
---

# Generate GKE manifests

Write GKE-flavored Kubernetes YAML that uses GCP features: Workload Identity for GCP API auth, BackendConfig for the GCLB health check and CDN, and ManagedCertificate for TLS.

## Inputs

`$ARGUMENTS` is a description of the workload. Examples:

- `api behind managed cert at api.example.com, replicas 3, needs Firestore read`
- `worker that reads from Pub/Sub subscription orders-worker`
- `internal service for other clusters`

If inputs are missing, ask:

- Image and tag.
- Hostname for the Ingress, or confirm the workload is cluster-internal.
- Whether the workload needs to call GCP APIs, and if so which ones. This drives Workload Identity.
- Which GCP service account to bind the Kubernetes service account to.
- Namespace. Default to `default` only for examples, otherwise ask.

## Required characteristics

1. **Workload Identity**: the Kubernetes ServiceAccount is annotated with `iam.gke.io/gcp-service-account: <gsa-email>`. The GSA separately gets `roles/iam.workloadIdentityUser` for `serviceAccount:<project>.svc.id.goog[<ns>/<ksa>]`.
2. **BackendConfig**: every Service fronted by GCLB has a matching BackendConfig. Wire it with the Service annotation `cloud.google.com/backend-config: '{"default":"<name>"}'`.
3. **ManagedCertificate**: TLS is provided by a `ManagedCertificate` CR. The Ingress references it via the annotation `networking.gke.io/managed-certificates`.
4. **Pinned image tag**. Never `latest`.
5. **Resource requests and limits** on every container.
6. **Readiness and liveness probes** that match the BackendConfig health check path when the workload is behind GCLB.
7. **Security context**: `runAsNonRoot: true`, a specific `runAsUser`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, and `readOnlyRootFilesystem: true` when the app allows it.
8. **Common labels**: `app.kubernetes.io/name` and `app.kubernetes.io/instance` on every object.

## Output steps

1. State the files and their target paths.
2. Write each manifest as its own file under `k8s/` (or the existing layout).
3. Print the kubectl commands to apply and verify.
4. Print the one-time `gcloud` commands to create the GSA and bind Workload Identity.

## Example: HTTP API with Workload Identity, BackendConfig, and ManagedCertificate

One-time setup (run once per workload):

```bash
PROJECT_ID=my-project
NS=default
KSA=api
GSA=api-runtime

gcloud iam service-accounts create $GSA \
  --display-name="Runtime SA for $KSA"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$GSA@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/datastore.user

gcloud iam service-accounts add-iam-policy-binding \
  $GSA@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT_ID.svc.id.goog[$NS/$KSA]"
```

File `k8s/serviceaccount.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: default
  annotations:
    iam.gke.io/gcp-service-account: api-runtime@my-project.iam.gserviceaccount.com
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/instance: api
```

File `k8s/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/instance: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
        app.kubernetes.io/instance: api
    spec:
      serviceAccountName: api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: api
          image: us-central1-docker.pkg.dev/my-project/app/api:1.0.0
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: GOOGLE_CLOUD_PROJECT
              value: my-project
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
```

File `k8s/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/instance: api
  annotations:
    cloud.google.com/backend-config: '{"default":"api"}'
    cloud.google.com/neg: '{"ingress": true}'
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

File `k8s/backendconfig.yaml`:

```yaml
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: api
spec:
  timeoutSec: 60
  connectionDraining:
    drainingTimeoutSec: 60
  healthCheck:
    checkIntervalSec: 10
    timeoutSec: 5
    healthyThreshold: 1
    unhealthyThreshold: 3
    type: HTTP
    requestPath: /healthz
    port: 8080
  logging:
    enable: true
    sampleRate: 1.0
```

File `k8s/managedcertificate.yaml`:

```yaml
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: api-cert
spec:
  domains:
    - api.example.com
```

File `k8s/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
  annotations:
    kubernetes.io/ingress.class: "gce"
    kubernetes.io/ingress.global-static-ip-name: api-static-ip
    networking.gke.io/managed-certificates: api-cert
    networking.gke.io/v1beta1.FrontendConfig: api-frontend
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  name: http
```

File `k8s/frontendconfig.yaml` (forces HTTP to HTTPS):

```yaml
apiVersion: networking.gke.io/v1beta1
kind: FrontendConfig
metadata:
  name: api-frontend
spec:
  redirectToHttps:
    enabled: true
    responseCodeName: MOVED_PERMANENTLY_DEFAULT
```

Reserve the global static IP once (outside the cluster):

```bash
gcloud compute addresses create api-static-ip --global
gcloud compute addresses describe api-static-ip --global --format='value(address)'
```

Point DNS for `api.example.com` at that IP. Certificate issuance will fail until DNS resolves.

Apply:

```bash
kubectl apply -f k8s/
kubectl rollout status deployment/api
kubectl get ingress api
kubectl describe managedcertificate api-cert
```

Certificate provisioning takes 10 to 60 minutes. The ManagedCertificate must show `status.certificateStatus: Active` before HTTPS works.

## Example: internal service (no public ingress)

Skip the Ingress, ManagedCertificate, and FrontendConfig. Keep the Deployment, Service, ServiceAccount, and BackendConfig. Use an internal load balancer if needed:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: worker
  annotations:
    networking.gke.io/load-balancer-type: "Internal"
spec:
  type: LoadBalancer
  selector:
    app.kubernetes.io/name: worker
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

## Common pitfalls

- Node pool must have Workload Identity enabled (`--workload-pool=<project>.svc.id.goog` on the cluster, `--workload-metadata=GKE_METADATA` on the node pool). Without both, pods fall back to the node service account.
- The ManagedCertificate status is separate from Ingress status. Check both.
- The Service must have `type: ClusterIP` or `NodePort` for GCLB. `LoadBalancer` creates a Network LB, not an HTTP LB.
- `cloud.google.com/neg: '{"ingress": true}'` on the Service is required for container-native load balancing. Without it, GCLB routes to node IPs and health checks can be misleading.

## Do not

- Do not set `runAsUser: 0` or leave `runAsNonRoot` unset.
- Do not use `latest` for the image tag.
- Do not use Kubernetes Secrets in plain text for GCP credentials. Use Workload Identity instead.
- Do not annotate the default namespace ServiceAccount with `iam.gke.io/gcp-service-account`. Create a dedicated KSA per workload.
