const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
// Reuse the YAML parser already locked by ESLint.
const yaml = require('js-yaml')

const root = path.resolve(__dirname, '..')
const read = file => yaml.load(fs.readFileSync(path.join(root, file), 'utf8'))
const backend = read('.github/actions/backend-checks/action.yml')
const frontend = read('.github/actions/frontend-checks/action.yml')
const ci = read('.github/workflows/ci.yml')
const base = 'a'.repeat(40), advanced = 'b'.repeat(40)
const actions = {
  './.github/actions/backend-checks': backend,
  './.github/actions/frontend-checks': frontend,
}
function expand(steps) {
  return steps.flatMap(step => actions[step.uses] ? expand(actions[step.uses].runs.steps) : [step])
}
assert.deepEqual(ci.jobs.backend.steps.slice(1), [{ uses: './.github/actions/backend-checks' }])
assert.deepEqual(ci.jobs.frontend.steps.slice(1), [{ uses: './.github/actions/frontend-checks' }])
assert.equal(backend.runs.steps[0].with['python-version'], '3.12')
assert.equal(frontend.runs.steps[0].with['node-version'], '20')
const gates = expand([{ uses: './.github/actions/backend-checks' }, { uses: './.github/actions/frontend-checks' }])
assert.deepEqual(gates.filter(s => s.run).map(s => s.run.split('\n')[0]), [
  'pip install -r requirements.txt', 'python -m pytest backend/tests/ -q', 'npm ci',
  'npx next lint', 'npm test', 'npm run typecheck', 'npm run build',
  'npx playwright install --with-deps chromium',
  'npm start -- --hostname 127.0.0.1 --port 3012 > /tmp/nfl-preview.log 2>&1 &',
])
assert.equal(gates.at(-1).env.AUDIT_USE_PUBLICATION_TIME, '1')
assert.match(gates.at(-1).run, /test "\$ready" -eq 1\s+npm run test:browser/)
for (const step of gates) {
  assert.equal(step.if, undefined)
  assert.equal(step['continue-on-error'], undefined)
  if (step.run) assert.equal(step.shell, 'bash')
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-publication-gates-'))
const bin = path.join(sandbox, 'bin')
fs.mkdirSync(bin)
// All external commands are inert. No training, git mutation or release call runs.
const stub = `#!/bin/bash
command="$(basename "$0") $*"
printf '%s\\n' "$command" >> "$MOCK_LOG"
if [ "$command" = "\${MOCK_FAIL:-}" ]; then exit 73; fi
case "$command" in
  'git rev-parse FETCH_HEAD') printf '%s\\n' "$MOCK_BASE" ;;
  'git rev-parse HEAD') printf '%s\\n' "\${MOCK_HEAD:-$MOCK_BASE}" ;;
  'git ls-remote --exit-code origin refs/heads/main')
    if [ "\${MOCK_REMOTE_EMPTY:-}" = 1 ]; then exit 2; fi
    remote="\${MOCK_REMOTE:-$MOCK_BASE}"
    if [ "\${MOCK_AFTER_UPLOAD:-}" = 1 ] && [ -f "$MOCK_LOG.uploaded" ]; then remote="$MOCK_ADVANCED"; fi
    printf '%s\\trefs/heads/main\\n' "$remote" ;;
  'git diff --cached --quiet -I'* ) exit 1 ;;
  'npm start '* ) exec /bin/sleep 30 ;;
  'curl '* ) if [ "\${MOCK_NOT_READY:-}" = 1 ]; then exit 7; fi ;;
  'gh release upload '* ) touch "$MOCK_LOG.uploaded"; printf 'PUBLISHED %s\\n' "$command" >> "$MOCK_LOG" ;;
  'git push '* )
    if [ "\${MOCK_PUSH_RACE:-}" = 1 ]; then exit 1; fi
    printf 'PUBLISHED %s\\n' "$command" >> "$MOCK_LOG" ;;
esac
`
for (const command of ['git', 'gh', 'pip', 'python', 'npm', 'npx', 'curl', 'gzip', 'cp', 'sleep']) {
  fs.writeFileSync(path.join(bin, command), command === 'sleep' ? '#!/bin/bash\nexit 0\n' : stub, { mode: 0o755 })
}
let count = 0
function run(steps, { failStep, ...extra } = {}) {
  const log = path.join(sandbox, `case-${count++}.log`)
  const envFile = log + '.env'
  fs.writeFileSync(log, ''); fs.writeFileSync(envFile, '')
  let env = { ...process.env, PATH: bin + ':' + process.env.PATH, GITHUB_ENV: envFile,
    MOCK_LOG: log, MOCK_BASE: base, MOCK_ADVANCED: advanced, GITHUB_RUN_ID: 'test', GITHUB_RUN_ATTEMPT: '1', ...extra }
  let stopped = false
  for (const step of steps) {
    if (step === failStep && !step.run) { stopped = true; break }
    if (!step.run) continue
    let command = step.run.replaceAll('/tmp/', sandbox + '/').replace(/\$\{\{[^}]*\}\}/g, 'test')
    if (step === failStep) env.MOCK_FAIL = step.name === 'Verify production UI' ? 'npm run test:browser' : step.run.trim()
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', command], {
      cwd: root, env: { ...env, ...step.env }, encoding: 'utf8', timeout: 10000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) { stopped = true; break }
    for (const line of fs.readFileSync(envFile, 'utf8').trim().split('\n')) {
      if (line.includes('=')) env[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1)
    }
  }
  return { stopped, log: fs.readFileSync(log, 'utf8') }
}
const noPublication = result => {
  assert.equal(result.stopped, true)
  assert.doesNotMatch(result.log, /gh release upload|git add |git commit |git push |PUBLISHED/)
}
try {
  for (const [file, cron, job] of [
    ['daily_forecast.yml', '0 11 * * *', 'forecast'],
    ['weekly_benchmark.yml', '0 13 * * 2', 'benchmark'],
  ]) {
    const workflow = read('.github/workflows/' + file)
    assert.deepEqual(workflow.permissions, { contents: 'write' })
    assert.deepEqual(workflow.on.schedule, [{ cron }])
    assert.deepEqual(workflow.concurrency, { group: 'nfl-data-publication', 'cancel-in-progress': false })
    const steps = workflow.jobs[job].steps
    const sync = steps.find(s => s.run === 'bash scripts/synchronize-publication.sh')
    assert.ok(sync && steps.indexOf(sync) === 1, 'Synchronize before generation and validation')
    const gateIndex = steps.findIndex(s => s.uses === './.github/actions/backend-checks')
    assert.ok(gateIndex > steps.indexOf(sync))
    assert.equal(steps[gateIndex + 1].uses, './.github/actions/frontend-checks')
    const publications = steps.slice(gateIndex + 2)
    for (const step of [sync, ...publications]) {
      assert.equal(step.if, undefined); assert.equal(step['continue-on-error'], undefined)
    }
    assert.ok(!steps.slice(0, gateIndex).some(s => /gh release upload|git (add|commit|push)\b/.test(s.run ?? '')))
    const commit = publications.at(-1)
    assert.match(commit.run, /git push origin HEAD:main/)
    assert.doesNotMatch(commit.run, /git pull|--rebase|--force|git add[^\n]*\|\| true/)
    assert.equal(publications.at(-2).run, 'bash scripts/verify-publication-base.sh')
    if (job === 'forecast') assert.equal(publications[0].run, 'bash scripts/verify-publication-base.sh')
    const sequence = [sync, ...gates, ...publications]
    for (const gate of gates) {
      noPublication(run(sequence, { failStep: gate }))
      console.log(`${file}: ${gate.uses ?? gate.name} failure blocks all publication`)
    }
    noPublication(run(sequence, { MOCK_NOT_READY: '1' }))
    noPublication(run(sequence, { MOCK_FAIL: 'git fetch --no-tags origin main' }))
    noPublication(run(sequence, { MOCK_FAIL: 'git merge --ff-only FETCH_HEAD' }))
    noPublication(run(sequence, { MOCK_HEAD: advanced }))
    noPublication(run(sequence, { MOCK_REMOTE: advanced }))
    noPublication(run(sequence, { MOCK_REMOTE_EMPTY: '1' }))
    const success = run(sequence)
    assert.equal(success.stopped, false)
    assert.match(success.log, /PUBLISHED git push origin HEAD:main/)
    if (job === 'forecast') {
      assert.equal(success.log.match(/PUBLISHED gh release upload/g).length, 2)
      const changedAfterUpload = run(sequence, { MOCK_AFTER_UPLOAD: '1' })
      assert.equal(changedAfterUpload.stopped, true)
      assert.equal(changedAfterUpload.log.match(/PUBLISHED gh release upload/g).length, 1, 'Only the unique backup survives a race before replacement')
      assert.doesNotMatch(changedAfterUpload.log, /gh release upload[^\n]*--clobber/)
      assert.doesNotMatch(changedAfterUpload.log, /git add |git commit |git push /)
    }
    const pushRace = run(sequence, { MOCK_PUSH_RACE: '1' })
    assert.equal(pushRace.stopped, true)
    assert.doesNotMatch(pushRace.log, /PUBLISHED git push/)
  }
  console.log(`Publication gates: ${count} inert failure/success cases passed; no live commands executed`)
} finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
