import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runTaskProcess, transientNetworkErrorPattern } from './task-process.mts'

const directories: string[] = []

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

/** Writes a script that fails with `message` on the chosen stream until it has run `failures` times, counting attempts in a file. */
function createFlakyCommand(message: string, failures: number, stream: 'stderr' | 'stdout' = 'stderr') {
	const directory = mkdtempSync(path.join(tmpdir(), 'task-process-'))
	directories.push(directory)
	const counterPath = path.join(directory, 'attempts')
	writeFileSync(counterPath, '0')
	const scriptPath = path.join(directory, 'flaky.mjs')
	writeFileSync(
		scriptPath,
		[
			"import { readFileSync, writeFileSync } from 'node:fs'",
			`const attempts = Number(readFileSync(${JSON.stringify(counterPath)}, 'utf8')) + 1`,
			`writeFileSync(${JSON.stringify(counterPath)}, String(attempts))`,
			`if (attempts <= ${failures}) { console.${stream === 'stderr' ? 'error' : 'log'}(${JSON.stringify(message)}); process.exit(1) }`,
			"console.log('ok')",
		].join('\n'),
	)
	return { attempts: () => Number(readFileSync(counterPath, 'utf8')), command: ['bun', scriptPath], directory }
}

test('recognizes registry connection failures but not audit findings', () => {
	expect(transientNetworkErrorPattern.test('error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - ConnectionClosed')).toBe(true)
	expect(transientNetworkErrorPattern.test('error: getaddrinfo ENOTFOUND registry.npmjs.org')).toBe(true)
	expect(transientNetworkErrorPattern.test('1 vulnerabilities (1 high)')).toBe(false)
})

test('retries a task that fails with a transient network error until it succeeds', async () => {
	const flaky = createFlakyCommand('error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - ConnectionClosed', 2)
	expect(await runTaskProcess({ command: flaky.command, cwd: '.', repositoryRoot: flaky.directory, retryTransientNetworkErrors: true, retryDelayMs: 1 })).toBe(0)
	expect(flaky.attempts()).toBe(3)
})

test('gives up after the configured attempts and reports the failure', async () => {
	const flaky = createFlakyCommand('error: fetch failed', 5)
	expect(await runTaskProcess({ command: flaky.command, cwd: '.', repositoryRoot: flaky.directory, retryTransientNetworkErrors: true, attempts: 2, retryDelayMs: 1 })).toBe(1)
	expect(flaky.attempts()).toBe(2)
})

test('does not retry genuine failures or tasks that opted out of retries', async () => {
	const finding = createFlakyCommand('2 vulnerabilities (1 moderate, 1 high)', 1)
	expect(await runTaskProcess({ command: finding.command, cwd: '.', repositoryRoot: finding.directory, retryTransientNetworkErrors: true, retryDelayMs: 1 })).toBe(1)
	expect(finding.attempts()).toBe(1)
	const reportMentioningNetwork = createFlakyCommand('high: fetch failed to validate TLS certificates (CVE-2026-0001)', 1, 'stdout')
	expect(await runTaskProcess({ command: reportMentioningNetwork.command, cwd: '.', repositoryRoot: reportMentioningNetwork.directory, retryTransientNetworkErrors: true, retryDelayMs: 1 })).toBe(1)
	expect(reportMentioningNetwork.attempts()).toBe(1)
	const optedOut = createFlakyCommand('error: fetch failed', 1)
	expect(await runTaskProcess({ command: optedOut.command, cwd: '.', repositoryRoot: optedOut.directory })).toBe(1)
	expect(optedOut.attempts()).toBe(1)
})
