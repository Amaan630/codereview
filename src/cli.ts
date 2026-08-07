#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import getPort from 'get-port'
import { isGitRepo, getCustomGitDiff, getGitDiff } from './git.js'
import { startServer } from './server.js'
import { loadSettings } from './settings.js'
import { normalizeReviewManifest } from './review-manifest.js'
import { checkReviewPlan } from './check-review-plan.js'

const isCheckCommand = process.argv[2] === 'check'
const rawArgs = isCheckCommand ? process.argv.slice(3) : process.argv.slice(2)

const { values, positionals } = parseArgs({
  args: rawArgs,
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string' },
    'review-manifest': { type: 'string' },
    all: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean' },
    version: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
})

if (isCheckCommand) {
  if (!isGitRepo()) {
    console.error('Error: not inside a git repository')
    process.exit(1)
  }
  const customDiffArgs = positionals.length > 0 ? positionals : undefined
  const patch = customDiffArgs
    ? getCustomGitDiff(customDiffArgs)
    : getGitDiff({ staged: values.all, untracked: values.all })
  const manifestPath = values['review-manifest'] ?? '.codereview/review.json'
  const manifest = normalizeReviewManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  const { ok, problems } = checkReviewPlan(patch, manifest)
  if (ok) {
    console.log('review plan check passed: every file and every change block is covered.')
    process.exit(0)
  }
  console.error(`review plan check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

if (values.help) {
  console.log(`codereview - Local ordered code review tool for git diffs

Usage: codereview [options] [-- <git diff args>]

Options:
  -p, --port <port>  Port to run the server on (default: random available port)
  --host <host>      Host address to bind to (default: 127.0.0.1). Pass
                     0.0.0.0 to expose the server to the local network.
  --review-manifest <path>
                     JSON file with review-order metadata for changed files
  --all               Include staged, unstaged, and untracked working-tree changes
  --no-open          Don't open the browser automatically
  -v, --version      Show version number
  -h, --help         Show this help message

Examples:
  codereview                        Review uncommitted changes
  codereview -- --staged            Review staged changes
  codereview -- HEAD~3              Review last 3 commits
  codereview -- main..feature       Compare branches
  codereview --all --review-manifest .codereview/review.json
  codereview --review-manifest .codereview/review.json -- origin/main...refs/review-pr/123/head
  codereview --host 0.0.0.0         Allow other machines on the LAN to review`)
  process.exit(0)
}

if (values.version) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'))
  console.log(pkg.version)
  process.exit(0)
}

// Everything after -- becomes custom git diff args
const customDiffArgs = positionals.length > 0 ? positionals : undefined

if (!isGitRepo()) {
  console.error('Error: not inside a git repository')
  process.exit(1)
}

const port = await getPort(values.port ? { port: parseInt(values.port, 10) } : undefined)
const host = values.host ?? '127.0.0.1'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(__dirname, 'client')
const { existsSync } = await import('node:fs')
const resolvedClientDir = existsSync(clientDir)
  ? clientDir
  : resolve(process.cwd(), 'dist/client')

const { port: actualPort } = await startServer({
  port,
  host,
  clientDir: resolvedClientDir,
  customDiffArgs,
  allChanges: values.all,
  reviewManifestPath: values['review-manifest'],
})

const localUrl = `http://${host}:${actualPort}`

console.log(`codereview server running at ${localUrl}`)

if (!values['no-open']) {
  const settings = loadSettings()
  const openHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const openUrl = `http://${openHost}:${actualPort}`
  const openModule = await import('open')
  let appName: string | readonly string[] | undefined
  if (settings.browser) {
    const apps = openModule.apps as Record<string, string | readonly string[]>
    appName = apps[settings.browser] || settings.browser
  }
  const options = appName ? { app: { name: appName } } : {}
  openModule.default(openUrl, options)
}

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})
