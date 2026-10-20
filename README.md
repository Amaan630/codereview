# codereview

`codereview` is a local ordered GitHub PR review workflow for coding agents.

It combines:

- a browser diff UI derived from `diffx`
- a `--review-manifest` option for dependency-aware file ordering
- a local comments API so agents can seed review findings without posting to GitHub
- a copyable `review-pr` skill that can bootstrap this repo from anywhere

## Quick Start

Clone the repo:

```bash
git clone https://github.com/Amaan630/codereview.git
cd codereview
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

Run the local review UI inside any git repo:

```bash
node /path/to/codereview/dist/cli.mjs
```

For PR review sessions, copy `SKILL.md` into your agent's skills directory as `review-pr/SKILL.md`.

Use **Option/Alt+Enter** or **Ask reviewer** to ask about a line; **Command/Ctrl+Enter**
still saves a normal comment. For live inline answers, ask the originating agent to stay
in review mode and run `codereview listen <local-review-url>`. It waits up to 50 seconds
for questions; the agent answers through `/api/comments/:id/replies` and listens again.
Questions remain waiting if that chat is stopped. Answers appear automatically within
three seconds; text is not streamed word by word.

The skill does not depend on where it is copied. It resolves the CLI in this order:

1. `codereview` on `PATH`
2. `review-pr-diffx` on `PATH`
3. `$CODEREVIEW_REPO`
4. a cache clone at `~/.codereview/codereview`

## CLI

```bash
codereview [options] [-- <git diff args>]
```

Options:

```text
-p, --port <port>        Server port
--host <host>            Host address to bind to
--review-manifest <path> JSON file with review-order metadata for changed files
--no-open                Do not open the browser automatically
-v, --version            Show version number
-h, --help               Show help
```

Examples:

```bash
codereview -- HEAD~3
codereview -- main..feature
codereview -- --staged
codereview --all --review-manifest .codereview/review.json
codereview --review-manifest .codereview/review.json -- origin/main...refs/review-pr/123/head
```

If you do not install the package globally, use:

```bash
node /path/to/codereview/dist/cli.mjs --review-manifest .codereview/review.json -- origin/main...refs/review-pr/123/head
```

## Review Manifest

The manifest controls review order, the introduction, and concise per-file summaries.

```json
{
  "pr": {
    "number": 123,
    "url": "https://github.com/owner/repo/pull/123",
    "base_ref": "origin/main",
    "head_ref": "refs/review-pr/123/head"
  },
  "summary": "Lets users review an assembled drawing packet as one saved document. It does this with packet persistence, API wiring, output generation, and coverage.",
  "files": [
    {
      "path": "src/api.ts",
      "order": 1,
      "summary": "Exposes the packet through the public API."
    }
  ]
}
```

The UI warns when diff files are missing from the manifest or manifest paths are not present in the diff.

New reviews use `.codereview/review.json`. Older `pr-<number>-review-manifest.json` files remain valid when passed to `--review-manifest`; separate top-level `implementation` fields and per-file `justification` fields remain supported.

## Stack Reviews

To split one diff into reviewable parts, add `title` and `stack` to the same manifest:

```json
{
  "title": "Drawing changes",
  "stack": [
    {
      "id": "scales",
      "title": "Half-step scales",
      "summary": "Allows half-step drawing scales.\n\nPreviously, only whole steps were available.",
      "files": ["src/scales.ts"]
    }
  ],
  "files": [{ "path": "src/scales.ts", "summary": "Adds half-step scales." }]
}
```

Every manifest file belongs to exactly one entry. Entry order controls the sidebar;
its file list controls reading order. The URL hash selects an entry. Descriptions
preserve paragraphs, and all entries share comments and viewed state in one session.
This groups a diff for review; it does not create commits or pull requests.
Run the usual `codereview check` and launch commands with this manifest.

## Skill

The canonical skill is [SKILL.md](SKILL.md).

Install manually by copying it into a skill folder:

```bash
mkdir -p ~/.codex/skills/review-pr
cp SKILL.md ~/.codex/skills/review-pr/SKILL.md
```

The skill handles the main gotchas:

- no hard-coded local paths
- no PR branch checkout into the user's working tree
- no GitHub review comments posted by default
- base branch read from `gh pr view`, not assumed to be `main`
- manifest validation against `gh pr diff --name-only`
- local CLI bootstrap from `PATH`, `$CODEREVIEW_REPO`, or a cache clone

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run test
corepack pnpm run build
```

## Attribution

The browser diff UI is derived from [`wong2/diffx`](https://github.com/wong2/diffx). This repo keeps that local-review foundation and adds the ReviewPR manifest workflow and copyable skill packaging.

## License

MIT
