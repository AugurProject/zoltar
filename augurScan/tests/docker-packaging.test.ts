import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const windowsLauncher = join(import.meta.dir, '..', 'start.bat')
const rootDockerIgnore = join(import.meta.dir, '..', '..', '.dockerignore')
const dockerfile = join(import.meta.dir, '..', 'Dockerfile')
const composeFile = join(import.meta.dir, '..', 'compose.yaml')
const schemaFile = join(import.meta.dir, '..', 'schema.sql')
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
		expect(runtimeStage).toContain('COPY augurScan/migrations ./augurScan/migrations')
		expect(runtimeStage).not.toContain('COPY augurScan/browser')
		expect(runtimeStage).not.toContain('COPY --from=browser-build /workspace/augurScan/node_modules')
	})

	test('packages source-provenance inputs beside the runtime server', async () => {
		const source = await readFile(dockerfile, 'utf8')
		const runtimeStage = source.slice(source.indexOf('FROM oven/bun:1.3.14-alpine AS runtime'))
		expect(runtimeStage).toContain('COPY augurScan/package.json augurScan/bun.lock ./augurScan/')
		expect(runtimeStage).toContain('COPY augurScan/scripts/verify-compose-source.ts ./augurScan/scripts/verify-compose-source.ts')
		expect(runtimeStage).toContain('COPY augurScan/scripts/verify-export-page.ts ./augurScan/scripts/verify-export-page.ts')
		expect(runtimeStage).not.toContain('COPY augurScan/package.json augurScan/bun.lock ./\n')
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

	test('forwards external PostgreSQL and standby indexer settings through Compose', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain(`POSTGRES_URL: \${POSTGRES_URL:-postgres://augurscan:\${POSTGRES_PASSWORD:-augurscan-local}@postgres:5432/augurscan}`)
		expect(source).toContain(`DISABLE_INDEXER: \${DISABLE_INDEXER:-0}`)
	})

	test('runs the PostgreSQL release used to generate the authoritative schema', async () => {
		const composeSource = await readFile(composeFile, 'utf8')
		const schemaSource = await readFile(schemaFile, 'utf8')
		const composeVersion = /image: postgres:(\d+\.\d+)-alpine/u.exec(composeSource)?.[1]
		const schemaVersion = /Dumped from database version (\d+\.\d+)/u.exec(schemaSource)?.[1]
		if (composeVersion === undefined) throw new Error('Compose must pin a PostgreSQL alpine image with a major and minor release')
		if (schemaVersion === undefined) throw new Error('The authoritative schema must record its PostgreSQL server release')
		expect(composeVersion).toBe(schemaVersion)
	})
})
