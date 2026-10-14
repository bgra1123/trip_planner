export const meta = {
  name: 'build-and-test',
  description: 'Agent 1 implements a scoped code change; Agent 2 independently verifies it (self-test + code review) and reports pass/fail with findings, looping back to Agent 1 once if it fails.',
  whenToUse: 'Use when you have a well-scoped code change to make in this repo and want an independent tester to check it before you commit — not for open-ended exploration or multi-feature work.',
  phases: [
    { title: 'Build', detail: 'Agent 1 implements args.task in the working tree' },
    { title: 'Test', detail: 'Agent 2 runs the self-test suite and reviews the diff' },
    { title: 'Fix', detail: 'Agent 1 addresses the tester\'s findings, if any' },
    { title: 'Retest', detail: 'Agent 2 re-verifies after the fix' },
  ],
}

// Two independent roles, deliberately: Agent 1 never sees its own work marked
// "done" by itself, and Agent 2 is told explicitly not to take Agent 1's
// summary on faith — it re-runs the self-test and reads the diff itself.
// This only matters because the two are separate subagent calls with no
// shared context; each gets everything it needs spelled out in its prompt.

const REPO = '/home/user/trip_planner'

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What was implemented, 2-4 sentences' },
    filesChanged: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths touched' },
    selfTestAdded: { type: 'boolean', description: 'Whether new self-test assertions were added' },
    notes: { type: 'string', description: 'Assumptions made, things left out, known gaps the tester should know about' },
  },
  required: ['summary', 'filesChanged', 'selfTestAdded'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    selfTestOutput: { type: 'string', description: 'Key output from running the self-test suite — pass/fail counts, or the failure' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
          description: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
    summary: { type: 'string', description: 'One paragraph: is this safe to commit, what would you tell the user' },
  },
  required: ['verdict', 'selfTestOutput', 'findings', 'summary'],
}

function buildPrompt(task) {
  return `You are Agent 1 (Builder) in a build-test loop for the TripAgent trip-planner repo at ${REPO}.

First: cd into ${REPO} and run \`git status\` and \`git branch --show-current\` to orient yourself. Then read the relevant existing files before writing anything — don't guess at conventions this codebase already has opinions about.

TASK:
${task}

Repo conventions to follow:
- src/utils/parseTripNotes.js is the notes-shorthand grammar (FLIGHT:/HOTEL:/ACTIVITY:/NOTE:/RATE:/WINDOW: lines) and the cost model. Read it before adding any new row-producing logic.
- src/utils/tripAgentOffers.js normalizes captured input into the same row shape the planner's table already uses (offerToRow, normalizeOffer, offersFromNotesText). New capture paths should produce rows through this pipeline, not a new parallel shape.
- extension/ is the MV3 browser extension. extension/popup.html + popup.js are the capture UI; extension/bridge.js and src/utils/tripAgentBridge.js define the postMessage envelope types (OFFERS, NOTES) between the extension and the page.
- scripts/tripagent-selftest.mjs is the project's entire test harness — a plain Node script using check()/ok() assertions, no test framework. Every feature in this codebase has assertions added here, in the same style. Add assertions for whatever you build.
- The one hard rule threaded through this whole codebase: never invent or guess a value. Leave it blank/excluded rather than fabricate it. If your feature touches a value that can't be verified, follow that pattern.
- Keep the diff minimal and scoped to the task. Don't refactor unrelated code.

Do NOT commit or push. Leave your changes in the working tree for review.

Report: a 2-4 sentence summary of what you built, the list of repo-relative file paths you changed, whether you added self-test assertions, and any notes on assumptions or known gaps the tester should know about.`
}

function fixPrompt(task, prevBuild, test) {
  const findings = (test.findings || [])
    .map((f) => `- [${f.severity}] ${f.description}${f.file ? ` (${f.file})` : ''}`)
    .join('\n') || '(no itemized findings — see summary)'
  return `You are Agent 1 (Builder), fixing issues an independent tester found in your previous attempt at the same task.

ORIGINAL TASK:
${task}

YOUR PREVIOUS SUMMARY:
${prevBuild.summary}

FILES YOU CHANGED:
${(prevBuild.filesChanged || []).join(', ') || '(none reported)'}

TESTER'S SELF-TEST OUTPUT:
${test.selfTestOutput}

TESTER'S FINDINGS (fix these):
${findings}

TESTER'S SUMMARY:
${test.summary}

Go back into ${REPO} and fix these issues directly in the files you already touched (or others, if the findings require it). Don't start over unless a finding says the whole approach is wrong. Do NOT commit or push.

Report the same fields as before — summary, filesChanged, selfTestAdded, notes — reflecting the state AFTER your fix.`
}

function testPrompt(build) {
  return `You are Agent 2 (Tester) for the TripAgent trip-planner repo at ${REPO}. Agent 1 (Builder) just made changes. Verify them independently — do not take the summary on faith.

BUILDER'S SUMMARY:
${build.summary}

BUILDER'S CLAIMED FILES CHANGED:
${(build.filesChanged || []).join(', ') || '(none reported)'}

BUILDER'S NOTES:
${build.notes || '(none)'}

Do this, in order:
1. cd into ${REPO}. Run \`git status\` and \`git diff\` — confirm the actual changes match what the builder claims, and that nothing unrelated was touched.
2. Run \`node scripts/tripagent-selftest.mjs\` and capture its output verbatim. A failing self-test is an automatic 'fail' verdict, full stop.
3. Review the changed code against this codebase's conventions: does it go through the existing row/offer pipeline rather than inventing a parallel shape; does it ever guess or fabricate a value instead of leaving it blank; is there stray or leftover code; if the builder claims selfTestAdded but you don't see assertions actually covering the new behavior, that is itself a finding.
4. If any plain JS file's behavior is unclear from reading it, run \`node --check <file>\` to at least confirm it parses (note: extension/background.js is a classic script, not a module — \`node --check\` on it directly is correct, no special handling needed).

Report a structured verdict. 'pass' only if the self-test passes AND the change is sound and consistent with the codebase. 'fail' otherwise, with specific, itemized findings (severity + description + file where applicable) — be concrete enough that another agent could fix each one without asking you a follow-up question. Also give a one-paragraph summary: is this safe to commit, and what would you tell the user about it.`
}

phase('Build')
let build = await agent(buildPrompt(args.task), { label: 'agent1:build', phase: 'Build', schema: BUILD_SCHEMA })

phase('Test')
let test = await agent(testPrompt(build), { label: 'agent2:test', phase: 'Test', schema: TEST_SCHEMA })

const rounds = [{ round: 1, build, test }]
const maxRounds = (args && args.maxRounds) || 2
let round = 1

while (test && test.verdict === 'fail' && round < maxRounds) {
  round += 1
  log(`Round ${round - 1} failed (${(test.findings || []).length} finding(s)) — sending back to Agent 1`)

  phase('Fix')
  build = await agent(fixPrompt(args.task, build, test), { label: `agent1:fix-round-${round}`, phase: 'Fix', schema: BUILD_SCHEMA })

  phase('Retest')
  test = await agent(testPrompt(build), { label: `agent2:retest-round-${round}`, phase: 'Retest', schema: TEST_SCHEMA })

  rounds.push({ round, build, test })
}

if (test && test.verdict === 'fail') {
  log(`Still failing after ${round} round(s) — stopping at the round cap, not looping further`)
}

return {
  task: args.task,
  maxRounds,
  roundsTaken: round,
  finalVerdict: test ? test.verdict : 'unknown',
  finalBuild: build,
  finalTest: test,
  history: rounds,
}
