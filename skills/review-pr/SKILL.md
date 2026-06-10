---
name: review-pr
description: Use when the user asks for ReviewPR, asks to review a GitHub PR in a local ordered diff viewer, wants an exhaustive dependency-aware file reading order for a PR, or wants a diffx-style PR review UI where files are ordered by reviewer comprehension and seeded with local security, performance, maintainability, and correctness comments.
---

# ReviewPR

Use this skill to turn a GitHub PR into a local ordered code review session.

The deliverable is a local browser URL running `codereview` with:

- every changed PR file present exactly once
- files ordered by the way the behavior works
- a short plain-English reason attached to each file
- local review comments for real findings, placed on the right changed line

## Requirements

The local machine needs `git`, `gh`, `node >= 20`, and Corepack-managed `pnpm`.

Before using a PR, verify GitHub auth:

```bash
gh auth status
```

## Resolve the CLI

Do not assume this skill file lives inside the cloned repo. A copied skill can be anywhere.

Resolve `codereview` in this order:

1. use `codereview` from `PATH`
2. use `review-pr-diffx` from `PATH`
3. use `$CODEREVIEW_REPO` if it points at a checkout
4. clone/build `https://github.com/Amaan630/codereview.git` into `~/.codereview/codereview`

Use this shell shape when you need the local CLI:

```bash
resolve_codereview() {
  if command -v codereview >/dev/null 2>&1; then
    printf '%s\n' codereview
    return
  fi
  if command -v review-pr-diffx >/dev/null 2>&1; then
    printf '%s\n' review-pr-diffx
    return
  fi

  local repo="${CODEREVIEW_REPO:-$HOME/.codereview/codereview}"
  if [ ! -d "$repo/.git" ]; then
    mkdir -p "$(dirname "$repo")"
    git clone https://github.com/Amaan630/codereview.git "$repo"
  fi
  if [ ! -f "$repo/dist/cli.mjs" ]; then
    corepack enable
    corepack pnpm --dir "$repo" install --frozen-lockfile
    corepack pnpm --dir "$repo" run build
  fi
  printf 'node %s\n' "$repo/dist/cli.mjs"
}
```

If the cached checkout exists but looks stale or broken, run:

```bash
git -C "$HOME/.codereview/codereview" pull --ff-only
corepack pnpm --dir "$HOME/.codereview/codereview" install --frozen-lockfile
corepack pnpm --dir "$HOME/.codereview/codereview" run build
```

## Writing Style

Use a terse review-comment style:

- short, natural, teammate-like
- lowercase unless a code symbol, acronym, or proper noun needs caps
- direct cause/effect, not architecture prose
- concrete nouns from the code: "the dataset", "the panel", "the row", "the task"
- no verbose review boilerplate
- no phrases like "desired final state", "ownership semantics", "reviewer comprehension flow", or "materialize"

For file-order reasons, write one simple sentence. Good examples:

```text
this is the settings entry point, so it shows what the user can actually do.
this owns the scheduler rule, so read it before the task callers.
this proves the permission branch and the malformed payload case.
```

Bad examples:

```text
Read this first because it is the user-facing entry point for the behavior.
Read this after the backend service chain because it connects the new actions to the facade and shows the staff-only dispatch gate.
```

## Workflow

1. Treat the PR URL or number the user supplied as authoritative.

2. Fetch PR metadata and changed files with `gh`.

Use commands like:

```bash
gh pr view <pr> --json number,title,url,baseRefName,headRefName,body,commits,changedFiles,additions,deletions
gh pr diff <pr> --name-only
```

When the user supplies a full GitHub URL, use that URL directly with `gh`.

3. Fetch the PR into a local ref without checking it out.

For PR `<number>`:

```bash
git fetch origin <base-branch> "pull/<number>/head:refs/review-pr/<number>/head"
```

Use the PR's actual base branch instead of assuming `main`.

4. Inspect the diff deeply enough to understand the review flow.

Useful commands:

```bash
git diff --stat origin/<base>...refs/review-pr/<number>/head
git diff --unified=80 origin/<base>...refs/review-pr/<number>/head -- <path>
```

Do not stop at the file list. Read enough hunks to know what owns the behavior, which files are entry points, which files define contracts, which files are runtime roots, and which files are tests or compatibility fallout.

5. Run the review pass before launching the UI.

Cover all of these lanes:

- **correctness:** behavior, permissions, data ownership, state transitions, error handling, and tests
- **security:** RBAC/ACL, IDOR risk, input validation, secrets, unsafe data exposure
- **performance:** hot paths, query count, locks, fan-out, resource usage, retries, cache behavior
- **maintainability:** whether the code will stay readable as the feature grows in several directions

Think ahead. Ask how this code handles plausible extensions: new permissions, new config fields, multiple providers, larger data, retries, background jobs, partial failure, customer self-service, migration rollback, and future tests.

Keep only real findings. Do not add praise comments. Do not add comments for obvious enum additions, imports, route wiring, or markup whose purpose is already clear.

Each finding must have:

- path
- side: `additions` or `deletions`
- changed line number
- exact line content
- short body, written in the style above

Prefer comments that point at the line that creates the risk, not a nearby unchanged line.

6. Write a manifest file under the repo being reviewed.

Suggested path:

```bash
mkdir -p .codereview
$EDITOR .codereview/pr-<number>-review-manifest.json
```

Manifest shape:

```json
{
  "pr": {
    "number": 11900,
    "url": "https://github.com/owner/repo/pull/11900",
    "base_ref": "origin/main",
    "head_ref": "refs/review-pr/11900/head"
  },
  "files": [
    {
      "path": "path/from/repo/root.ts",
      "order": 1,
      "justification": "this is the UI entry point, so it shows what the user can do."
    }
  ]
}
```

Manifest rules:

- Include every path from `gh pr diff <pr> --name-only`, exactly once.
- Order by behavior flow, not directory order.
- Start with the surface that explains the behavior if the UI/API entry point makes the change understandable.
- Put shared types/contracts before callers that depend on them when the caller cannot be judged without the contract.
- Put data model / migration / persistence roots before services that depend on new fields.
- Put service/runtime execution before endpoint glue.
- Put rendering adapters after their data contracts and API hooks.
- Put tests after the behavior they prove.
- Put pure fixture/type fallout last.
- Each justification should answer "why this file here?" in one natural sentence.

7. Validate the manifest before launching.

Quick check:

```bash
node - <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const pr = "<number>";
const manifestPath = `.codereview/pr-${pr}-review-manifest.json`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const diffPaths = new Set(cp.execFileSync("gh", ["pr", "diff", pr, "--name-only"], { encoding: "utf8" }).trim().split("\n").filter(Boolean));
const manifestPaths = manifest.files.map((entry) => entry.path);
const missing = [...diffPaths].filter((path) => !manifestPaths.includes(path)).sort();
const stale = manifestPaths.filter((path) => !diffPaths.has(path));
const dupes = [...new Set(manifestPaths.filter((path, index) => manifestPaths.indexOf(path) !== index))].sort();
const todos = manifest.files.filter((entry) => entry.justification?.includes("TODO")).map((entry) => entry.path);
if (missing.length || stale.length || dupes.length || todos.length) {
  console.log(JSON.stringify({ missing, stale, dupes, todos }, null, 2));
  process.exit(1);
}
console.log("manifest ok");
NODE
```

8. Launch `codereview` from the repo being reviewed.

```bash
CODEREVIEW_CLI="$(resolve_codereview)"
$CODEREVIEW_CLI \
  --review-manifest .codereview/pr-<number>-review-manifest.json \
  -- origin/<base>...refs/review-pr/<number>/head
```

If the user wants the URL but not an auto-opened browser, add `--no-open`.

9. Seed local review comments.

If the review pass found issues, add them to the running local server. Do not post to GitHub.

Use the server URL printed by `codereview`:

```bash
curl -sS -X POST "$CODEREVIEW_URL/api/comments" \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{
  "filePath": "path/from/repo/root.ts",
  "side": "additions",
  "lineNumber": 42,
  "lineContent": "const row = rows[0]",
  "body": "this assumes the query always returns a row. if the client has no config yet, this throws before the panel can show its empty state."
}
JSON
```

Line rules:

- use `side: "additions"` for new/right-side lines and the new-file line number
- use `side: "deletions"` for removed/left-side lines and the old-file line number
- `lineContent` must be the exact code text for that side, without the diff `+` or `-`
- if the best issue is on unchanged context, anchor it to the closest changed line that actually causes or exposes the issue
- if there is no honest changed-line anchor, mention the finding in the final response instead of forcing a local comment

Comment body rules:

- one or two short sentences
- explain the concrete risk and the expected fix direction
- do not include severity labels in the body
- do not write "nit" comments
- do not comment on every file; sparse, high-signal comments are better

After seeding comments, verify:

```bash
curl -sS "$CODEREVIEW_URL/api/comments"
```

Report the `codereview server running at http://...` URL to the user, along with the number of local review comments added.

## Constraints

- Do not check out the PR branch into the user's working tree.
- Do not commit, push, reply to GitHub comments, or resolve review threads.
- Do not mutate unrelated dirty files.
- Do not leave the final answer as just a file order if the user asked for ReviewPR; the intended deliverable is the local ordered review URL.
- Always do the security, performance, maintainability, and correctness review pass before final response.
- Add findings as local comments when they can be anchored to changed lines.
