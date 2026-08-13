import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrypoint = join(import.meta.dir, '..', 'scripts', 'docker-entrypoint.sh')
const dockerfile = join(import.meta.dir, '..', 'Dockerfile')
const composeFile = join(import.meta.dir, '..', 'compose.yaml')
const example = join(import.meta.dir, '..', 'config', 'operator.example.json')
const windowsLauncher = join(import.meta.dir, '..', 'start.bat')
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-docker-'))
	temporaryDirectories.push(directory)
	await mkdir(join(directory, '.state'))
	await mkdir(join(directory, 'config'))
	await writeFile(join(directory, 'config', 'operator.example.json'), await readFile(example))
	return directory
}

async function runEntrypoint(directory: string, path = process.env['PATH']) {
	const child = Bun.spawn([entrypoint, '/bin/true'], { cwd: directory, env: { ...process.env, PATH: path }, stderr: 'pipe', stdout: 'pipe' })
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`Docker entrypoint exited ${exitCode.toString()}: ${await new Response(child.stderr).text()}`)
}

describe('Docker entrypoint', () => {
	test('provides a location-independent Windows launcher', async () => {
		const source = await readFile(windowsLauncher, 'utf8')
		expect(source).toContain('pushd "%~dp0"')
		expect(source).toContain('docker compose up --build --force-recreate')
		expect(source).toContain('exit /b %exit_code%')
	})

	test('provides a local-only dashboard password when .env is absent', async () => {
		const source = await readFile(composeFile, 'utf8')
		expect(source).toContain('${ZOLTAR_BOT_DASHBOARD_PASSWORD:-')
		expect(source).not.toContain('${ZOLTAR_BOT_DASHBOARD_PASSWORD:?')
	})

	test('installs production dependencies where shared bot sources can resolve them', async () => {
		const source = await readFile(dockerfile, 'utf8')
		expect(source).toContain('cd shared \\\n\t&& bun install --frozen-lockfile --production')
		expect(source).toContain('cd ../bots/shared \\\n\t&& bun install --frozen-lockfile --production')
	})

	test('has a Linux-compatible shell shebang', async () => {
		const source = await readFile(entrypoint, 'utf8')
		expect(source.startsWith('#!/bin/sh\n')).toBe(true)
		expect(source).not.toContain('\r')
	})

	test('creates a private Compose-ready operator configuration on first start', async () => {
		const directory = await fixture()
		await runEntrypoint(directory)

		const settingsFile = join(directory, '.state', 'operator.json')
		const settings = await readFile(settingsFile, 'utf8')
		expect(settings).toContain('"paused": true')
		expect(settings).toContain('"execute": false')
		expect(settings).toContain('"once": false')
		expect(settings).toContain('"ui": true')
		expect(settings).toContain('"uiHost": "0.0.0.0"')
		expect(settings).not.toContain('"uiHost": "127.0.0.1"')
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

	test('does not preserve a partial configuration when initialization fails', async () => {
		const directory = await fixture()
		const executableDirectory = join(directory, 'bin')
		await mkdir(executableDirectory)
		const failingSed = join(executableDirectory, 'sed')
		await writeFile(failingSed, '#!/bin/sh\nprintf partial\nexit 1\n')
		await chmod(failingSed, 0o755)

		await expect(runEntrypoint(directory, `${executableDirectory}:${process.env['PATH'] ?? ''}`)).rejects.toThrow('Docker entrypoint exited 1')
		expect(await Bun.file(join(directory, '.state', 'operator.json')).exists()).toBe(false)

		await runEntrypoint(directory)
		expect(await Bun.file(join(directory, '.state', 'operator.json')).exists()).toBe(true)
	})
})
