import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const windowsLauncher = join(import.meta.dir, '..', 'start.bat')
const rootDockerIgnore = join(import.meta.dir, '..', '..', '.dockerignore')
const dockerfile = join(import.meta.dir, '..', 'Dockerfile')
const composeFile = join(import.meta.dir, '..', 'compose.yaml')
const rootGitIgnore = join(import.meta.dir, '..', '..', '.gitignore')

describe('Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})

	test('excludes local environment secrets from the repository build context', async () => {
		const patterns = (await readFile(rootDockerIgnore, 'utf8')).split(/\r?\n/u)
		expect(patterns).toContain('**/.env')
		expect(patterns).toContain('**/.env.*')
		expect(patterns).toContain('!**/.env.example')
	})

	test('builds browser TypeScript outside the final runtime image', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('FROM oven/bun:1.3.14-alpine AS browser-build')
		expect(source).toContain('COPY augurScan/browser ./browser')
		expect(source).toContain('RUN bun run build')
		const runtimeStage = source.slice(source.indexOf('FROM oven/bun:1.3.14-alpine AS runtime'))
		expect(runtimeStage).toContain('COPY --from=browser-build /workspace/augurScan/public ./augurScan/public')
		expect(runtimeStage).toContain('COPY augurScan/schema.sql ./augurScan/schema.sql')
		expect(runtimeStage).not.toContain('COPY augurScan/migrations')
		expect(runtimeStage).not.toContain('COPY augurScan/browser')
		expect(runtimeStage).not.toContain('COPY --from=browser-build /workspace/augurScan/node_modules')
	})

	test('persists the rotating RPC exchange log in a dedicated writable volume', async () => {
		const dockerfileSource = await readFile(dockerfile, 'utf8')
		const composeSource = await readFile(composeFile, 'utf8')
		const gitIgnorePatterns = (await readFile(rootGitIgnore, 'utf8')).split(/\r?\n/u)
		expect(dockerfileSource).toContain('mkdir -p /workspace/augurScan/logs /var/log/augurscan && chown -R bun:bun /workspace/augurScan/logs /var/log/augurscan')
		expect(composeSource).toContain('RPC_LOG_PATH: /var/log/augurscan/rpc.jsonl')
		expect(composeSource).toContain('augurscan-logs:/var/log/augurscan')
		expect(composeSource).toContain('augurscan-logs:')
		expect(gitIgnorePatterns).toContain('/augurScan/logs/')
	})
})
