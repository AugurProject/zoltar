import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exportScript = path.join(projectRoot, 'scripts', 'export-history.sh')

test('runs and verifies every export page before stopping the isolated container', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-export-history-'))
	const exportDirectory = path.join(directory, 'evidence')
	const dockerTrace = path.join(directory, 'docker.trace')
	const verifierTrace = path.join(directory, 'verifier.trace')
	try {
		const process = Bun.spawn(
			[
				'bash',
				'-c',
				`set -euo pipefail
source "$1"
export AUGURSCAN_DATABASE_MODE=external
export AUGURSCAN_RESTORE_URL='postgres://restore.invalid/augurscan_restore'
export AUGURSCAN_CHAIN_ID=11155111
export AUGURSCAN_EXPORT_DIRECTORY="$2"
export AUGURSCAN_EXPORT_CONTAINER=augurscan-export-test
export AUGURSCAN_DOCKER_TRACE="$3"
export AUGURSCAN_VERIFIER_TRACE="$4"
export AUGURSCAN_CURL_COUNT_FILE="$5"
printf 0 > "$AUGURSCAN_CURL_COUNT_FILE"
docker() { printf '%s\n' "$*" >> "$AUGURSCAN_DOCKER_TRACE"; }
augurscan_export_readiness() { return 0; }
augurscan_curl() {
  local headers= body= page
  while test "$#" -gt 0; do
    case "$1" in
      --dump-header) headers=$2; shift 2 ;;
      --output) body=$2; shift 2 ;;
      *) shift ;;
    esac
  done
  page=$(cat "$AUGURSCAN_CURL_COUNT_FILE")
  printf '{"page":%s}\n' "$page" > "$body"
  if test "$page" = 0; then
    printf 'HTTP/1.1 200 OK\r\nx-augurscan-next-cursor: page-two\r\n\r\n' > "$headers"
  else
    printf 'HTTP/1.1 200 OK\r\n\r\n' > "$headers"
  fi
  printf '%s' "$((page + 1))" > "$AUGURSCAN_CURL_COUNT_FILE"
  printf 200
}
augurscan_verify_export_page() {
  printf '%s\n' "$*" >> "$AUGURSCAN_VERIFIER_TRACE"
  printf '{"verified":true}\n'
}
augurscan_export_history`,
				'augurscan-export-history-test',
				exportScript,
				exportDirectory,
				dockerTrace,
				verifierTrace,
				path.join(directory, 'curl-count'),
			],
			{ cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' },
		)
		expect(await process.exited).toBe(0)
		expect(await new Response(process.stderr).text()).toBe('')
		expect(await new Response(process.stdout).text()).toContain(`Validated export: ${exportDirectory}`)
		expect(await readFile(path.join(exportDirectory, 'page-0', 'evidence.ndjson'), 'utf8')).toBe('{"page":0}\n')
		expect(await readFile(path.join(exportDirectory, 'page-1', 'evidence.ndjson'), 'utf8')).toBe('{"page":1}\n')
		expect(await readFile(path.join(exportDirectory, 'page-1', 'validation.json'), 'utf8')).toBe('{"verified":true}\n')
		const dockerCommands = await readFile(dockerTrace, 'utf8')
		expect(dockerCommands).toContain('compose run --detach --rm --no-deps')
		expect(dockerCommands).toContain('stop augurscan-export-test')
		expect(dockerCommands).not.toContain('rm --force')
		const verifierCalls = (await readFile(verifierTrace, 'utf8')).trim().split('\n')
		expect(verifierCalls).toHaveLength(2)
		expect(verifierCalls[0]).not.toContain('page-two')
		expect(verifierCalls[1]).toContain('/evidence/page-0/validation.json page-two')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('rejects a bundled restore URL that does not identify the verified database', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-export-history-validation-'))
	try {
		const process = Bun.spawn(['bash', exportScript], {
			cwd: projectRoot,
			env: {
				...processEnv(),
				AUGURSCAN_DATABASE_MODE: 'bundled',
				AUGURSCAN_RESTORE_URL: 'postgres://augurscan:password@postgres:5432/wrong_database',
				AUGURSCAN_RESTORE_DATABASE: 'augurscan_restore',
				AUGURSCAN_CHAIN_ID: '1',
				AUGURSCAN_EXPORT_DIRECTORY: path.join(directory, 'evidence'),
			},
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(await process.exited).toBe(2)
		expect(await new Response(process.stdout).text()).toBe('')
		expect(await new Response(process.stderr).text()).toContain('must name the verified restore database')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

const processEnv = (): Record<string, string> =>
	Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])))
