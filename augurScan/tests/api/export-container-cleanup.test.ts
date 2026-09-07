import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cleanupScript = path.join(projectRoot, 'scripts', 'export-container-cleanup.sh')

const runFailureHarness = async (failure: 'readiness' | 'transport' | 'verifier') => {
	const container = `augurscan-export-test-${failure}`
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-export-cleanup-'))
	const trace = path.join(directory, 'docker.trace')
	try {
		const process = Bun.spawn(
			[
				'bash',
				'-c',
				`set -euo pipefail
source "$1"
export AUGURSCAN_EXPORT_CONTAINER="$2"
export AUGURSCAN_DOCKER_TRACE="$4"
docker() { printf '%s\\n' "$*" >> "$AUGURSCAN_DOCKER_TRACE"; }
augurscan_install_export_cleanup
case "$3" in
  readiness) augurscan_readiness() { return 1; }; augurscan_readiness ;;
  transport) augurscan_curl() { return 1; }; augurscan_curl ;;
  verifier) augurscan_verifier() { return 1; }; augurscan_verifier ;;
esac`,
				'augurscan-export-cleanup-test',
				cleanupScript,
				container,
				failure,
				trace,
			],
			{ cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' },
		)
		return {
			exitCode: await process.exited,
			stdout: await new Response(process.stdout).text(),
			stderr: await new Response(process.stderr).text(),
			trace: await readFile(trace, 'utf8'),
			container,
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

for (const failure of ['readiness', 'transport', 'verifier'] as const) {
	test(`removes the exact isolated export container once after a ${failure} failure`, async () => {
		const result = await runFailureHarness(failure)
		expect(result.exitCode).toBe(1)
		expect(result.trace).toBe(`rm --force ${result.container}\n`)
		expect(result.stdout).toBe('')
		expect(result.stderr).toBe('')
	})
}

test('disarms automatic cleanup after the isolated export container stops successfully', async () => {
	const container = 'augurscan-export-test-success'
	const process = Bun.spawn(
		[
			'bash',
			'-c',
			`set -euo pipefail
source "$1"
export AUGURSCAN_EXPORT_CONTAINER="$2"
docker() { printf '%s\\n' "$*"; }
augurscan_install_export_cleanup
docker stop "$AUGURSCAN_EXPORT_CONTAINER"
augurscan_disarm_export_cleanup`,
			'augurscan-export-cleanup-test',
			cleanupScript,
			container,
		],
		{ cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' },
	)
	expect(await process.exited).toBe(0)
	expect(await new Response(process.stdout).text()).toBe(`stop ${container}\n`)
	expect(await new Response(process.stderr).text()).toBe('')
})
