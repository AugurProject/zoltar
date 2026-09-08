import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchCommands, dockerInstructions, parseDockerfile, requireDockerStage, shellCommandSegments } from '../../../tooling/testing/packaging-parsers.ts'

const dockerfile = join(import.meta.dir, '..', 'Dockerfile')
const dockerignore = join(import.meta.dir, '..', 'Dockerfile.dockerignore')
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
		const commands = batchCommands(await readFile(windowsLauncher, 'utf8'))
		expect(commands.at(0)).toBe('pushd "%~dp0" || exit /b 1')
		expect(commands.slice(-5)).toEqual(['docker compose up --build --force-recreate', 'set "exit_code=%errorlevel%"', 'popd', 'pause', 'exit /b %exit_code%'])
	})

	test('builds and installs both shared packages where bot sources can resolve them', async () => {
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const builder = requireDockerStage(stages, 'shared-builder')
		const runtime = stages.at(-1)
		if (runtime === undefined) throw new Error('Missing runtime Docker stage')
		const ignoreSource = await readFile(dockerignore, 'utf8')
		expect(builder.base).toContain('-alpine')
		expect(dockerInstructions(builder, 'RUN').flatMap(shellCommandSegments)).toContain('bun ./tooling/repo/build-shared.mts')
		expect(dockerInstructions(runtime, 'COPY')).toEqual(
			expect.arrayContaining([
				'--from=shared-builder /source/shared/ ./shared/',
				'bots/liquidator/src/ ./bots/liquidator/src/',
				'docs/mainnet-deployment-addresses.json docs/sepolia-deployment-addresses.json ./docs/',
				'bots/liquidator/scripts/check-process-lock-runtime.mts ./bots/liquidator/scripts/check-process-lock-runtime.mts',
			]),
		)
		expect(stages.flatMap(stage => dockerInstructions(stage, 'COPY')).some(copy => copy.includes('ui/coreShared/favicon'))).toBe(false)
		expect(ignoreSource).not.toContain('ui/coreShared/favicon')
		expect(ignoreSource).toContain('!docs/mainnet-deployment-addresses.json')
		expect(ignoreSource).toContain('!docs/sepolia-deployment-addresses.json')
		const installCommands = dockerInstructions(runtime, 'RUN').flatMap(shellCommandSegments)
		expect(installCommands).toEqual(expect.arrayContaining(['cd shared/core', 'cd ../../bots/shared', 'cd ../liquidator']))
		expect(installCommands.filter(command => command === 'bun /tmp/tooling/repo/install-frozen.mts . --production')).toHaveLength(3)
		expect(ignoreSource).toContain('!bots/liquidator/scripts/check-process-lock-runtime.mts')
		expect(installCommands).toContain('bun ./scripts/check-process-lock-runtime.mts')
	})

	test('starts without host UID, GID, or .env configuration', async () => {
		const compose = Bun.YAML.parse(await readFile(composeFile, 'utf8')) as { services?: { liquidator?: { environment?: Record<string, unknown>; ports?: unknown[] } } }
		const liquidator = compose.services?.liquidator
		expect(liquidator?.environment).not.toHaveProperty('LIQUIDATOR_UID')
		expect(liquidator?.environment).not.toHaveProperty('LIQUIDATOR_GID')
		expect(liquidator?.environment).not.toHaveProperty('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		expect(liquidator?.environment?.['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED']).toBe('true')
		expect(liquidator?.ports).toContain('127.0.0.1:4183:4183')
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
