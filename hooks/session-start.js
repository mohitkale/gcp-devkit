#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

function has(rel) {
  try { return fs.existsSync(path.join(cwd, rel)); } catch { return false; }
}
function isDir(rel) {
  try { return fs.statSync(path.join(cwd, rel)).isDirectory(); } catch { return false; }
}

const cwdFiles = (() => { try { return fs.readdirSync(cwd); } catch { return []; } })();
const findings = [];

const tfFiles = cwdFiles.filter(f => f.endsWith(".tf"));
if (tfFiles.length > 0) {
  let usesGoogle = false;
  for (const f of tfFiles) {
    try {
      const body = fs.readFileSync(path.join(cwd, f), "utf8");
      if (/hashicorp\/google|provider\s+"google"/.test(body)) { usesGoogle = true; break; }
    } catch {}
  }
  if (usesGoogle) {
    findings.push("- Terraform for GCP detected. Use `/gcp-devkit:terraform-gcp <resource>` to extend or add resources following project conventions.");
  }
}

if (has("service.yaml") || has("cloudbuild.yaml") || has("cloudrun.yaml")) {
  findings.push("- Cloud Run or Cloud Build config detected. Use `/gcp-devkit:cloud-run-deploy` to scaffold a deploy, or `/gcp-devkit:gcloud-debug cloud-run <service>` to diagnose failures.");
}

if (has("app.yaml")) {
  findings.push("- App Engine app.yaml detected. Use `/gcp-devkit:gcloud-debug appengine` for runtime issues.");
}

if (has("firestore.rules") || has(".firebaserc")) {
  findings.push("- Firestore project detected. Use `/gcp-devkit:firestore-rules audit firestore.rules` to review security rules.");
}

if (has(".gcloudignore")) {
  findings.push("- .gcloudignore detected. A Cloud Run or Cloud Functions deploy is likely the active workflow.");
}

if (findings.length > 0) {
  const text = [
    "GCP DevKit plugin is active. Detected in " + cwd + ":",
    findings.join("\n"),
    "Run `/gcp-devkit:doctor` to check that gcloud, terraform, and kubectl are installed and authenticated."
  ].join("\n\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text
    }
  }));
}
process.exit(0);
