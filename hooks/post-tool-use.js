#!/usr/bin/env node
let input = "";
process.stdin.on("data", c => input += c);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== "Bash") return process.exit(0);
    const cmd = (data.tool_input && data.tool_input.command) || "";
    const stderr = (data.tool_response && data.tool_response.stderr) || "";
    const stdout = (data.tool_response && data.tool_response.stdout) || "";
    const notes = [];

    if (/\bterraform\s+plan\b/.test(cmd)) {
      notes.push("Terraform plan complete. Review `+`, `~`, and `-` lines carefully before `terraform apply`. For IAM-related changes, `/gcp-devkit:iam-audit` cross-checks against current bindings.");
    }
    if (/\bterraform\s+apply\b/.test(cmd)) {
      notes.push("Terraform apply completed. Commit any `terraform.tfstate` changes (or confirm remote state was updated). Use `/gcp-devkit:terraform-gcp` to extend the module with additional resources.");
    }
    if (/\bgcloud\s+run\s+deploy\b/.test(cmd)) {
      notes.push("Cloud Run deploy kicked off. Tail logs with `gcloud run services logs read <service> --region=<region> --limit=50`. If 500s appear, `/gcp-devkit:gcloud-debug cloud-run <service>` pulls the full diagnostic.");
    }
    if (/\bgcloud\s+container\s+clusters\s+(create|delete)\b/.test(cmd)) {
      notes.push("GKE cluster state-change command. After create, confirm workload identity is enabled with `gcloud container clusters describe <name> --region=<region> --format='value(workloadIdentityConfig.workloadPool)'`.");
    }
    if (/\bgcloud\s+projects\s+add-iam-policy-binding\b/.test(cmd) || /\bgcloud\s+projects\s+remove-iam-policy-binding\b/.test(cmd)) {
      notes.push("IAM binding changed. `/gcp-devkit:iam-audit` will flag any overly broad roles (Owner, Editor at project scope) that may now be in place.");
    }
    if (/\bgcloud\s+builds\s+submit\b/.test(cmd) && /FAILURE|failed/i.test(stderr + stdout)) {
      notes.push("Cloud Build failed. Check the build log URL printed above; common causes are a stale `_SUBSTITUTION` value or a missing service account role.");
    }

    if (notes.length > 0) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n") }
      }));
    }
  } catch (e) {}
  process.exit(0);
});
