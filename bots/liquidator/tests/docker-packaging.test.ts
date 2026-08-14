import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dockerfile = join(import.meta.dir, '..', 'Dockerfile')
const composeFile = join(import.meta.dir, '..', 'compose.yaml')
const entrypoint = join(import.meta.dir, '..', 'scripts', 'docker-entrypoint.sh')
const example = join(import.meta.dir, '..', 'config', 'operator.example.json')
const windowsLauncher = join(import.meta.dir, '..', 'start.bat')
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-docker-'))
	temporaryDirectories.push(directory)
	await mkdir(join(directory, '.state'))
	await mkdir(join(directory, 'config'))
	await writeFile(join(directory, 'config', 'operator.example.json'), await readFile(example))
	return directory
}

async function runEntrypoint(directory: string) {
	const child = Bun.spawn([entrypoint, '/bin/true'], { cwd: directory, env: process.env, stderr: 'pipe', stdout: 'pipe' })
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`Docker entrypoint exited ${exitCode.toString()}: ${await new Response(child.stderr).text()}`)
}

describe('Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const source = (await readFile(windowsLauncher, 'utf8')).replaceAll('\r\n', '\n')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate\nset "exit_code=%errorlevel%"\npopd\npause\nexit /b %exit_code%')
	})

	test('builds and installs both shared packages where bot sources can resolve them', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('-alpine AS shared-builder')
		expect(source).toContain('&& bun run shared:build')
		expect(source).toContain('COPY --from=shared-builder /source/shared/ ./shared/')
		expect(source).toContain('cd shared \\\n\t&& bun install --frozen-lockfile --production \\\n\t&& cd ../bots/shared \\\n\t&& bun install --frozen-lockfile --production')
	})

	test('starts without host UID, GID, or .env configuration', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).not.toContain('LIQUIDATOR_UID')
		expect(source).not.toContain('LIQUIDATOR_GID')
		expect(source).not.toContain('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		expect(source).toContain('ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED: "true"')
		expect(source).toContain('127.0.0.1:4183:4183')
	})

	test('creates a private Compose-ready operator configuration on first start', async () => {
		const directory = await fixture()
		await runEntrypoint(directory)

		const settingsFile = join(directory, '.state', 'operator.json')
		const settings = await readFile(settingsFile, 'utf8')
		expect(settings).toContain('"paused": true')
		expect(settings).toContain('"execute": false')
		expect(settings).toContain('"uiHost": "0.0.0.0"')
		expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
	})

	test('preserves an existing operator configuration', async () => {
		const directory = await fixture()
		const settingsFile = join(directory, '.state', 'operator.json')
		await writeFile(settingsFile, 'existing settings')
		await chmod(settingsFile, 0o644)

		await runEntrypoint(directory)

		expect(await readFile(settingsFile, 'utf8')).toBe('existing settings')
		expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
	})
})
