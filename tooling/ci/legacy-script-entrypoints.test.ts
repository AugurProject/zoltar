import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const runCli = (scriptPath: string, args: readonly string[]) =>
	Bun.spawnSync({
		cmd: [process.execPath, scriptPath, ...args],
		cwd: repositoryRoot,
		stdout: 'pipe',
		stderr: 'pipe',
	})

test('legacy change-classification entrypoint preserves arguments and output', () => {
	const canonical = runCli('tooling/ci/classify-ci-change.mts', ['README.md'])
	const compatibility = runCli('scripts/classify-ci-change.mts', ['README.md'])
	expect(compatibility.exitCode).toBe(canonical.exitCode)
	expect(compatibility.stdout.toString()).toBe(canonical.stdout.toString())
	expect(compatibility.stderr.toString()).toBe(canonical.stderr.toString())
})

test('legacy component entrypoint preserves argument validation and exit status', () => {
	const canonical = runCli('tooling/ci/run-component-ci.mts', ['missing-component'])
	const compatibility = runCli('scripts/run-component-ci.mts', ['missing-component'])
	expect(canonical.exitCode).not.toBe(0)
	expect(compatibility.exitCode).toBe(canonical.exitCode)
	expect(compatibility.stderr.toString()).toContain('Unknown component package: missing-component')
})

test('legacy frozen-install entrypoint executes the canonical implementation in process', () => {
	const source = readFileSync(path.join(repositoryRoot, 'scripts/install-frozen.mts'), 'utf8')
	expect(source).toContain("await import('../tooling/repo/install-frozen.mts')")
})

test('remaining legacy workflow entrypoints delegate to their canonical tooling owners', () => {
	const expectations = new Map([
		['scripts/merge-test-timings.mts', "await import('../tooling/testing/merge-test-timings.mts')"],
		['scripts/ensure-contract-artifacts.mts', 'runEnsureContractArtifactsCommand(process.argv.slice(2))'],
		['scripts/run-deploy-testnet.mts', 'runHeadlessTestnetDeployment(process.argv.slice(2))'],
		['scripts/documentation-tools-runtime.test.ts', "await import('../tooling/docs/documentation-tools-runtime.test.ts')"],
	])
	for (const [relativePath, delegation] of expectations) {
		expect(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')).toContain(delegation)
	}
})
