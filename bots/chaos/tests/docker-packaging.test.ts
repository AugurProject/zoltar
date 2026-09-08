import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchCommands, dockerInstructions, parseDockerfile, requireDockerStage, shellCommandSegments } from '../../../tooling/testing/packaging-parsers.ts'

const botDirectory = join(import.meta.dir, '..')
const dockerfile = join(botDirectory, 'Dockerfile')
const dockerignore = join(botDirectory, 'Dockerfile.dockerignore')
const composeFile = join(botDirectory, 'compose.yaml')
const entrypoint = join(botDirectory, 'scripts', 'docker-entrypoint.sh')
const example = join(botDirectory, 'config', 'operator.example.json')
const windowsLauncher = join(botDirectory, 'start.bat')
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-docker-'))
	temporaryDirectories.push(directory)
	await mkdir(join(directory, '.state'))
	await mkdir(join(directory, 'config'))
	await writeFile(join(directory, 'config', 'operator.example.json'), await readFile(example))
	return directory
}

async function runEntrypoint(directory: string) {
	const child = Bun.spawn([entrypoint, '/bin/true'], { cwd: directory, env: { ...process.env, ZOLTAR_BOT_CONTAINER: 'true', ZOLTAR_BOT_SIGNER_LOCK_ROOT: '.state/process-locks' }, stderr: 'pipe', stdout: 'pipe' })
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`Docker entrypoint exited ${exitCode.toString()}: ${await new Response(child.stderr).text()}`)
}

describe('chaos Docker packaging', () => {
	test('provides a location-independent Windows launcher', async () => {
		const commands = batchCommands(await readFile(windowsLauncher, 'utf8'))
		expect(commands.at(0)).toBe('pushd "%~dp0" || exit /b 1')
		expect(commands).toContain('if /I "%~1"=="doctor" goto doctor')
		for (const command of ['docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable', 'docker compose run --rm --no-deps chaos bun run doctor', 'docker compose up --build --force-recreate -d']) expect(commands).toContain(`${command} || exit /b 1`)
		expect(commands.indexOf('docker compose run --rm --no-deps chaos bun src/cli/doctor.ts --if-live-capable || exit /b 1')).toBeLessThan(commands.indexOf('docker compose up --build --force-recreate -d || exit /b 1'))
		expect(commands.some(command => command.includes('dashboard-password'))).toBe(false)
		expect(commands.some(command => command.includes('started with its persisted configuration'))).toBe(true)
		expect(commands.some(command => command.includes('started in paused dry-run mode'))).toBe(false)
		expect(commands.some(command => command.includes('exit /b 1'))).toBe(true)
	})

	test('builds shared packages and runs as the non-root Bun user', async () => {
		const stages = parseDockerfile(await readFile(dockerfile, 'utf8'))
		const builder = requireDockerStage(stages, 'shared-builder')
		const runtime = stages.at(-1)
		if (runtime === undefined) throw new Error('Missing runtime Docker stage')
		const copies = stages.flatMap(stage => dockerInstructions(stage, 'COPY'))
		const runtimeRuns = dockerInstructions(runtime, 'RUN').flatMap(shellCommandSegments)
		const ignoreSource = await readFile(dockerignore, 'utf8')
		expect(builder.base).toContain('-alpine')
		expect(dockerInstructions(builder, 'RUN').flatMap(shellCommandSegments)).toContain('bun ./tooling/repo/build-shared.mts')
		expect(copies).toEqual(expect.arrayContaining(['--from=shared-builder /source/shared/ ./shared/', 'bots/chaos/src/ ./bots/chaos/src/', 'bots/chaos/scripts/check-runtime.mts ./bots/chaos/scripts/check-runtime.mts', 'bots/chaos/scripts/validate-container-paths.mts ./bots/chaos/scripts/validate-container-paths.mts']))
		expect(copies.some(copy => copy.includes('solidity/tsconfig.json') && copy.includes('solidity/tsconfig-compile.json'))).toBe(true)
		expect(copies.some(copy => copy.includes('ui/coreShared/favicon'))).toBe(false)
		expect(ignoreSource).toContain('!bots/chaos/scripts/check-runtime.mts')
		expect(ignoreSource).toContain('!bots/chaos/scripts/validate-container-paths.mts')
		expect(ignoreSource).toContain('!solidity/tsconfig.json')
		expect(ignoreSource).not.toContain('ui/coreShared/favicon')
		expect(dockerInstructions(runtime, 'USER')).toEqual(['bun'])
		expect(runtimeRuns).toContain('bun ./scripts/check-runtime.mts')
		expect(await readFile(join(botDirectory, 'scripts', 'check-runtime.mts'), 'utf8')).toContain("import { main } from '../src/cli/run.ts'")
		expect(dockerInstructions(runtime, 'EXPOSE')).toContain('4193')
		expect(dockerInstructions(runtime, 'VOLUME')).toContain('["/app/bots/chaos/.state"]')
		const entrypointSource = await readFile(entrypoint, 'utf8')
		expect(entrypointSource).toContain('[ "$1" = \'bun\' ] && [ "$2" = \'run\' ] && [ "$3" = \'run\' ]')
		expect(entrypointSource).toContain('bun "$script_directory/../src/cli/doctor.ts" --if-live-capable')
		expect(entrypointSource.indexOf('--if-live-capable')).toBeLessThan(entrypointSource.indexOf('exec "$@"'))
	})

	test('publishes only the host-loopback dashboard port and retains state', async () => {
		const compose = Bun.YAML.parse(await readFile(composeFile, 'utf8')) as { services?: { chaos?: { environment?: Record<string, unknown>; healthcheck?: { test?: unknown[] }; ports?: unknown[]; volumes?: unknown[] } }; volumes?: Record<string, { name?: string }> }
		const chaos = compose.services?.chaos
		expect(chaos?.environment?.['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED']).toBe('true')
		expect(chaos?.environment?.['ZOLTAR_BOT_SIGNER_LOCK_ROOT']).toBe('.state/process-locks')
		expect(chaos?.environment).not.toHaveProperty('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		expect(chaos?.ports).toContain('127.0.0.1:4193:4193')
		expect(chaos?.volumes).toEqual(expect.arrayContaining(['chaos-state:/app/bots/chaos/.state', 'chaos-signer-locks:/app/bots/chaos/.state/process-locks']))
		expect(compose.volumes?.['chaos-signer-locks']?.name).toBe('zoltar-chaos-signer-locks')
		const healthCommand = chaos?.healthcheck?.test?.map(String).join(' ') ?? ''
		expect(healthCommand).toContain("fetch('http://127.0.0.1:4193/healthz')")
		expect(healthCommand).not.toContain('/readyz')
	})

	test('creates a private paused dry-run operator configuration on first start', async () => {
		const directory = await fixture()
		await runEntrypoint(directory)

		const settingsFile = join(directory, '.state', 'operator.json')
		const settings = await readFile(settingsFile, 'utf8')
		expect(settings).toContain('"paused": true')
		expect(settings).toContain('"execute": false')
		expect(settings).toContain('"allowHighRiskOperations": false')
		expect(settings).toContain('"uiHost": "0.0.0.0"')
		expect((await stat(join(directory, '.state'))).mode & 0o777).toBe(0o700)
		expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
	})

	test('preserves an existing configuration while restoring owner-only mode', async () => {
		const directory = await fixture()
		const settingsFile = join(directory, '.state', 'operator.json')
		const existingSettings = (await readFile(example, 'utf8')).replace('"uiHost": "127.0.0.1"', '"uiHost": "0.0.0.0"')
		await writeFile(settingsFile, existingSettings)
		await chmod(settingsFile, 0o644)

		await runEntrypoint(directory)

		expect(await readFile(settingsFile, 'utf8')).toBe(existingSettings)
		expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
	})

	test('rejects runtime state outside the persistent state volume', async () => {
		const directory = await fixture()
		const settingsFile = join(directory, '.state', 'operator.json')
		const settings: unknown = JSON.parse(await readFile(example, 'utf8'))
		if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('Expected example settings object')
		const runtime = Reflect.get(settings, 'runtime')
		if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) throw new Error('Expected example runtime object')
		Reflect.set(runtime, 'stateFile', join(directory, 'outside-state.json'))
		await writeFile(settingsFile, `${JSON.stringify(settings)}\n`)

		await expect(runEntrypoint(directory)).rejects.toThrow('runtime.stateFile must be a file or directory below')
	})

	test('rejects a signer lock outside the persistent state volume', async () => {
		const directory = await fixture()
		const child = Bun.spawn([entrypoint, '/bin/true'], {
			cwd: directory,
			env: { ...process.env, ZOLTAR_BOT_CONTAINER: 'true', ZOLTAR_BOT_SIGNER_LOCK_ROOT: join(directory, 'outside-locks') },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		expect(await child.exited).not.toBe(0)
		expect(await new Response(child.stderr).text()).toContain('ZOLTAR_BOT_SIGNER_LOCK_ROOT must be a file or directory below')
	})

	test('rejects live-capable container startup without a persistent signer lock root', async () => {
		const directory = await fixture()
		const child = Bun.spawn([entrypoint, '/bin/true'], {
			cwd: directory,
			env: { ...process.env, ZOLTAR_BOT_CONTAINER: 'true', ZOLTAR_BOT_SIGNER_LOCK_ROOT: '' },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		expect(await child.exited).not.toBe(0)
		expect(await new Response(child.stderr).text()).toContain('requires ZOLTAR_BOT_SIGNER_LOCK_ROOT in the persistent state volume')
	})

	test('rejects a symbolic-link configuration without changing its target', async () => {
		const directory = await fixture()
		const target = join(directory, 'outside-settings.json')
		await writeFile(target, 'outside settings')
		await chmod(target, 0o644)
		await symlink(target, join(directory, '.state', 'operator.json'))

		await expect(runEntrypoint(directory)).rejects.toThrow('must not be a symbolic link')
		expect((await stat(target)).mode & 0o777).toBe(0o644)
	})
})
