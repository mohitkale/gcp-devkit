---
name: terraform-gcp
description: Generate idiomatic Terraform for common GCP resources. Use when the user asks to write Terraform for a Cloud Run service, a GCS bucket with lifecycle rules, a Cloud SQL instance, a Pub/Sub topic and subscription, an Artifact Registry repository, or a service account with least privilege. Produces modular HCL that fits existing project layout when present.
argument-hint: "<resource type and purpose>"
allowed-tools: Read Write Edit Glob
---

# Generate Terraform for GCP

Write clean, idiomatic Terraform for GCP resources that follows best practices: pinned provider versions, explicit regions, least-privilege IAM, and variables for anything that changes between environments.

## Inputs

`$ARGUMENTS` is a description of what to create. Examples:

- `cloud run service named api in us-central1`
- `regional GCS bucket with 30 day lifecycle to Nearline`
- `cloud sql postgres 15 with private IP`
- `pubsub topic orders with subscription for worker`
- `artifact registry docker repo in us-central1`
- `service account for cloud run to read secrets and write logs`

If `$ARGUMENTS` is vague, ask:

- Region. Default to `us-central1` if none given.
- Project id. Default to `var.project_id`.
- Environment (dev, staging, prod) if the answer affects sizing.

## Required characteristics

Every HCL file you produce must follow these rules:

1. **Provider version pinned**: `hashicorp/google` pinned to `~> 5.20` in `versions.tf`. Never unpinned.
2. **Terraform version pinned**: `required_version = ">= 1.5.0"`.
3. **Inputs as variables**: project, region, and any name prefix are variables with types and defaults where reasonable.
4. **Outputs for consumers**: emit resource ids, URLs, or names that other modules will need.
5. **Labels**: set `labels` on every labelable resource with at least `environment`, `owner`, and `managed-by = "terraform"`.
6. **IAM**: use `google_*_iam_member` for additive bindings. Never use `google_*_iam_policy` on a shared resource, since it is authoritative and overwrites all other bindings.
7. **Encryption and networking defaults**: private by default. Public access is opt-in with a clearly named variable.
8. **No hardcoded project ids or secrets**. Secrets go through Secret Manager and are referenced by name.

## File layout

When the project already has Terraform:

1. Match the existing structure. If there is a `modules/` directory, add a new module under it. If files are grouped by resource type (for example `cloud_run.tf`, `pubsub.tf`), follow that pattern.
2. Extend the existing `variables.tf` and `outputs.tf` rather than creating new ones.

When there is no existing Terraform:

```
<project>/
  versions.tf
  providers.tf
  variables.tf
  outputs.tf
  main.tf
```

## Output steps

1. State the files you will write before writing them.
2. Write each file.
3. Show the commands to validate locally:

```bash
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

## Example: versions and providers

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.20"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "GCP project id."
}

variable "region" {
  type        = string
  description = "Default region."
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)."
}
```

## Example: Cloud Run service

```hcl
resource "google_service_account" "api" {
  account_id   = "api-runtime"
  display_name = "Runtime SA for api Cloud Run service"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
    max_instance_request_concurrency = 80

    containers {
      image = "us-central1-docker.pkg.dev/${var.project_id}/app/api:1.0.0"
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
        cpu_idle = true
      }
      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 2
        timeout_seconds       = 2
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = {
    environment = var.environment
    owner       = "platform"
    managed-by  = "terraform"
  }
}

output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Cloud Run service URL."
}
```

## Example: GCS bucket with lifecycle

```hcl
resource "google_storage_bucket" "artifacts" {
  name                        = "${var.project_id}-artifacts-${var.environment}"
  location                    = var.region
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    owner       = "platform"
    managed-by  = "terraform"
  }
}
```

## Example: Cloud SQL Postgres with private IP

Look up the target VPC with a data source. Replace `default` with the VPC name your project uses.

```hcl
data "google_compute_network" "vpc" {
  name = "default"
}

resource "google_compute_global_address" "private_ip_alloc" {
  name          = "cloudsql-private-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.vpc.self_link
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = data.google_compute_network.vpc.self_link
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

resource "google_sql_database_instance" "app" {
  name             = "app-${var.environment}"
  region           = var.region
  database_version = "POSTGRES_15"

  depends_on = [google_service_networking_connection.private_vpc]

  settings {
    tier              = "db-custom-2-7680"
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"
    disk_size         = 50
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.vpc.self_link
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = {
      environment = var.environment
      owner       = "platform"
      managed-by  = "terraform"
    }
  }

  deletion_protection = var.environment == "prod"
}

resource "google_sql_database" "app" {
  name     = "app"
  instance = google_sql_database_instance.app.name
}
```

## Example: Pub/Sub topic and subscription

```hcl
resource "google_pubsub_topic" "orders" {
  name = "orders"

  message_retention_duration = "604800s"

  labels = {
    environment = var.environment
    owner       = "platform"
    managed-by  = "terraform"
  }
}

resource "google_pubsub_topic" "orders_dlq" {
  name = "orders-dlq"
}

resource "google_pubsub_subscription" "worker" {
  name  = "orders-worker"
  topic = google_pubsub_topic.orders.id

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"
  enable_exactly_once_delivery = true

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.orders_dlq.id
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = ""
  }
}
```

## Example: Artifact Registry Docker repository

```hcl
resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "app"
  description   = "Container images for the application."
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-last-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }

  labels = {
    environment = var.environment
    owner       = "platform"
    managed-by  = "terraform"
  }
}
```

## Example: service account with least privilege

```hcl
resource "google_service_account" "worker" {
  account_id   = "orders-worker"
  display_name = "Service account for orders worker"
}

resource "google_project_iam_member" "worker_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_pubsub_subscription_iam_member" "worker_sub" {
  subscription = google_pubsub_subscription.worker.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.worker.email}"
}

data "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
}

resource "google_secret_manager_secret_iam_member" "worker_db" {
  secret_id = data.google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
```

## Do not

- Do not use `*_iam_policy` resources on shared projects, buckets, or topics. They overwrite all other bindings.
- Do not grant `roles/owner`, `roles/editor`, or `roles/iam.serviceAccountUser` at the project level on runtime service accounts.
- Do not set `force_destroy = true` on production GCS buckets.
- Do not leave `deletion_protection = false` on production Cloud SQL instances.
- Do not pin the provider to `latest` or leave it unpinned.
- Do not write secret values into Terraform. Use `google_secret_manager_secret_version` and reference the secret name.
