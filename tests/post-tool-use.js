#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const hook = path.join(__dirname, "..", "hooks", "post-tool-use.js");
const cases = [
  {
    name: "state-changing commands use neutral language",
    input: {
      tool_name: "Bash",
      tool_input: { command: "terraform apply -auto-approve && gcloud run deploy api --region=us-central1" },
      tool_response: { stdout: "", stderr: "ERROR: deployment failed" }
    },
    includes: ["Terraform apply was invoked", "Cloud Run deploy was invoked"],
    excludes: ["apply completed", "deploy kicked off"]
  },
  {
    name: "failed Cloud Build is identified",
    input: {
      tool_name: "Bash",
      tool_input: { command: "gcloud builds submit ." },
      tool_response: { stdout: "BUILD FAILURE", stderr: "" }
    },
    includes: ["Cloud Build failed"],
    excludes: []
  },
  {
    name: "other tools stay silent",
    input: { tool_name: "Read", tool_input: {}, tool_response: {} },
    includes: [],
    excludes: []
  }
];

let fail = 0;
for (const test of cases) {
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(test.input), encoding: "utf8" });
  if (result.status !== 0) {
    console.log(`FAIL ${test.name}: hook exited ${result.status}`);
    fail++;
    continue;
  }
  const output = result.stdout.trim();
  const context = output ? JSON.parse(output).hookSpecificOutput?.additionalContext || "" : "";
  const bad = test.includes.some(text => !context.includes(text)) || test.excludes.some(text => context.includes(text));
  if (bad || (test.name === "other tools stay silent" && output)) {
    console.log(`FAIL ${test.name}: ${output || "unexpectedly silent"}`);
    fail++;
  } else {
    console.log(`PASS ${test.name}`);
  }
}

console.log(`\n${cases.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
