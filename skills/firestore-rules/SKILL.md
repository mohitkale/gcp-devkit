---
name: firestore-rules
description: "Generate or audit Firestore security rules. Use when the user asks to write Firestore rules for a new collection, review an existing rules file, or find open access patterns like `allow read, write: if true` that expose every document to the public internet."
argument-hint: "[generate | audit] [path-to-rules-file]"
allowed-tools: Read Write Edit Grep Glob
---

# Generate or audit Firestore security rules

Firestore rules are the only thing between client apps and the database. A missing rule means the default allow in test mode, and a bad rule can expose every document to the internet. Treat this skill's output like production code.

## Inputs

`$ARGUMENTS` has two modes:

- `generate <description>`: create a new `firestore.rules` file for the described data model.
- `audit <path>`: review an existing rules file for common mistakes. Default path is `firestore.rules` at the project root.

If the mode is missing, detect based on whether a `firestore.rules` file exists in the working directory.

## Audit workflow

1. Read the rules file.
2. Use Grep to find patterns that are almost always wrong:

```
allow read, write: if true
allow read: if true
allow write: if true
allow read, write;
```

Also flag:

- Any rule that does not call `request.auth != null` and does not check document ownership.
- Use of `request.auth.uid == resource.data.userId` without also checking the field exists on write with `request.resource.data.userId == request.auth.uid`.
- Wildcards at the root (`match /{document=**}`) with read or write allowed.
- `allow create: if true` on collections that should require auth.
- `get()` calls inside rules without a `request.auth != null` check above them.
- Custom claims checks that compare to string literals without the `request.auth.token` prefix.

3. For each finding, report:
   - The rule file and line.
   - The exact risk in one sentence ("any unauthenticated user on the internet can read every order").
   - The replacement rule.

4. Test coverage: if the repo has `firestore.rules` but no `firestore.rules.test.ts` or similar, note that rules tests are missing and show the minimal setup.

## Generate workflow

1. Ask for the data model if it is not given:
   - Top-level collections and their document id scheme.
   - Which collections are user-owned (users can read and write their own docs).
   - Which collections are admin-only.
   - Which collections are public readable (for example a public profile directory).
   - Any custom claims in use (`admin`, `role`).
2. Write `firestore.rules` following the required structure.
3. Write a minimal `firestore.rules.test.js` using the Firebase rules unit test SDK.
4. Show the deploy command and the test command.

## Required structure

Every rules file uses:

- `rules_version = '2';` on the first line. Version 1 is legacy.
- A tight default-deny at the root. No wildcard read or write at the top.
- A helper function for auth and for ownership.
- One `match` block per collection with explicit `allow` rules for `get`, `list`, `create`, `update`, and `delete`. Do not combine into `read` and `write` unless the rules are identical for each sub-operation.

## Example: user-owned notes plus a public users directory

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isSignedIn() && request.auth.token.admin == true;
    }

    function hasRequiredFields(required) {
      return request.resource.data.keys().hasAll(required);
    }

    match /users/{userId} {
      allow get: if isSignedIn();
      allow list: if isSignedIn();
      allow create: if isOwner(userId)
        && hasRequiredFields(['displayName', 'createdAt'])
        && request.resource.data.createdAt == request.time;
      allow update: if isOwner(userId)
        && request.resource.data.createdAt == resource.data.createdAt;
      allow delete: if isAdmin();
    }

    match /notes/{noteId} {
      allow get: if isSignedIn() && resource.data.ownerId == request.auth.uid;
      allow list: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.ownerId == request.auth.uid
        && hasRequiredFields(['ownerId', 'title', 'body', 'createdAt'])
        && request.resource.data.createdAt == request.time;
      allow update: if isSignedIn()
        && resource.data.ownerId == request.auth.uid
        && request.resource.data.ownerId == resource.data.ownerId;
      allow delete: if isSignedIn()
        && resource.data.ownerId == request.auth.uid;
    }

    match /admin/{document=**} {
      allow read, write: if isAdmin();
    }
  }
}
```

Key points in this example:

- `list` on `notes` is gated by sign-in but not by ownership, because clients will issue a query like `where('ownerId', '==', uid)`. The `get` rule still enforces ownership per document. If your clients issue queries that could return other users' notes, tighten `list` or require a `ownerId` filter in the query via `request.query`.
- `create` pins `ownerId` to the caller, requires all needed fields, and forces `createdAt` to server time. This prevents forging another user's document and avoids clock skew.
- `update` forbids changing `ownerId` (no account takeover by rewriting the field).
- The admin wildcard is only reachable by admins. It is not a generic escape hatch.

## Example: test harness

File `firestore.rules.test.js` with the Firebase rules unit testing SDK (pin the version):

```javascript
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-firestore-rules",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

test("unauthenticated user cannot read notes", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(db.doc("notes/n1").get());
});

test("owner can read their own note", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("notes/n1").set({ ownerId: "alice", title: "t", body: "b", createdAt: new Date() });
  });
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(db.doc("notes/n1").get());
});

test("other user cannot read a note they do not own", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("notes/n1").set({ ownerId: "alice", title: "t", body: "b", createdAt: new Date() });
  });
  const db = testEnv.authenticatedContext("bob").firestore();
  await assertFails(db.doc("notes/n1").get());
});
```

Install the emulator and test SDK, pinning versions:

```bash
npm install --save-dev @firebase/rules-unit-testing@3.0.4 jest@29.7.0
```

Run the emulator in one shell:

```bash
firebase emulators:start --only firestore
```

Run tests in another:

```bash
npx jest firestore.rules.test.js
```

## Deploy

```bash
firebase deploy --only firestore:rules
```

## Common audit findings

- **Critical**: `allow read, write: if true;` anywhere. Every document matched by the enclosing match block is world-readable and world-writable.
- **Critical**: `match /{document=**} { allow read, write: if request.auth != null; }`. Any authenticated user can read and write any document in the database. Authentication is not authorization.
- **High**: `allow update: if request.auth.uid == resource.data.ownerId;` without also checking `request.resource.data.ownerId == resource.data.ownerId`. An attacker can change `ownerId` on update and take over documents.
- **High**: `allow list: if true;` on any collection with sensitive fields. `list` does not run per document. It checks the query.
- **Medium**: missing `hasAll` checks on create. Clients can write documents with unexpected fields or omit required fields.
- **Medium**: rules that use `get()` to look up another document without a `request.auth != null` guard above them. Unauthenticated traffic can still trigger the `get()`.

## Do not

- Do not write rules that rely on client-supplied booleans or strings to grant access.
- Do not mix `read` and `write` allows with different conditions into one statement. Split into `get`, `list`, `create`, `update`, `delete` when the conditions differ.
- Do not deploy rules without running the emulator tests first.
- Do not paste Firestore document contents into the conversation during an audit if they may contain user data.
