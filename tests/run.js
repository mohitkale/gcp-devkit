#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOOK = path.join(__dirname, "..", "hooks", "session-start.js");
const FIXTURES = path.join(__dirname, "fixtures");

const names = fs.readdirSync(FIXTURES).filter(n =>
  fs.statSync(path.join(FIXTURES, n)).isDirectory()
);

let pass = 0, fail = 0;
for (const name of names) {
  const cwd = path.join(FIXTURES, name);
  const expPath = path.join(cwd, ".expected-context");
  const expected = fs.existsSync(expPath) ? fs.readFileSync(expPath, "utf8").trim() : null;

  let out = "";
  try {
    out = execSync(`node "${HOOK}"`, { cwd, encoding: "utf8" });
  } catch (e) {
    console.log(`FAIL ${name}: hook crashed: ${e.message}`);
    fail++;
    continue;
  }

  const trimmed = out.trim();

  if (expected === "none") {
    if (trimmed === "") {
      console.log(`PASS ${name} (silent)`);
      pass++;
    } else {
      console.log(`FAIL ${name}: expected silent, got: ${trimmed.slice(0, 80)}`);
      fail++;
    }
    continue;
  }

  if (trimmed === "") {
    console.log(`FAIL ${name}: hook was silent but expected context`);
    fail++;
    continue;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const ctx = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    if (!ctx) {
      console.log(`FAIL ${name}: missing additionalContext`);
      fail++;
      continue;
    }
    if (expected && !ctx.includes(expected)) {
      console.log(`FAIL ${name}: expected context to contain "${expected}"`);
      console.log(`  actual: ${ctx.slice(0, 160)}`);
      fail++;
      continue;
    }
    console.log(`PASS ${name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${name}: invalid JSON: ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
