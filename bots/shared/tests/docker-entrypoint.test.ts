import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrypoint = join(import.meta.dir, '..', 'scripts', 'docker-entrypoint.sh')
const botsDirectory = join(import.meta.dir, '..', '..')
const temporaryDirectories: string[] = []

// Every bot image that ships the shared entrypoint seeds its first configuration from its own example.
const botsUsingSharedEntrypoint = [
	{ bot: 'liquidator', expectedSettings: [] },
	{ bot: 'open-oracle-arbitrager', expectedSettings: ['"once": false', '"ui": true'] },
]

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function fixture(bot: string) {
	const directory = await mkdtemp(join(tmpdir(), `zoltar-${bot}-docker-`))
	temporaryDirectories.push(directory)
	await mkdir(join(directory, '.state'))
	await mkdir(join(directory, 'config'))
	await writeFile(join(directory, 'config', 'operator.example.json'), await readFile(join(botsDirectory, bot, 'config', 'operator.example.json')))
	return directory
}

function entrypointEnvironment(overrides: Record<string, string | undefined>) {
	const environment: Record<string, string | undefined> = { ...process.env, ZOLTAR_LIQUIDATOR_CONFIG: undefined, OPEN_ORACLE_ARBITRAGER_CONFIG: undefined, ...overrides }
	return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

async function runEntrypoint(directory: string, path = process.env['PATH'], overrides: Record<string, string> = {}) {
	const child = Bun.spawn([entrypoint, '/bin/true'], { cwd: directory, env: entrypointEnvironment({ PATH: path, ...overrides }), stderr: 'pipe', stdout: 'pipe' })
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`Docker entrypoint exited ${exitCode.toString()}: ${await new Response(child.stderr).text()}`)
}

describe('shared bot Docker entrypoint', () => {
	test('has a Linux-compatible shell shebang', async () => {
		const source = await readFile(entrypoint, 'utf8')
		expect(source.startsWith('#!/bin/sh\n')).toBe(true)
		expect(source).not.toContain('\r')
	})

	for (const { bot, expectedSettings } of botsUsingSharedEntrypoint) {
		test(`creates a private Compose-ready ${bot} configuration on first start`, async () => {
			const directory = await fixture(bot)
			await runEntrypoint(directory)

			const settingsFile = join(directory, '.state', 'operator.json')
			const settings = await readFile(settingsFile, 'utf8')
			for (const expected of ['"paused": true', '"execute": false', '"uiHost": "0.0.0.0"', ...expectedSettings]) expect(settings).toContain(expected)
			expect(settings).not.toContain('"uiHost": "127.0.0.1"')
			expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
		})
	}

	test('preserves an existing operator configuration', async () => {
		const directory = await fixture('liquidator')
		const settingsFile = join(directory, '.state', 'operator.json')
		await writeFile(settingsFile, 'existing settings')
		await chmod(settingsFile, 0o644)

		await runEntrypoint(directory)

		expect(await readFile(settingsFile, 'utf8')).toBe('existing settings')
		expect((await stat(settingsFile)).mode & 0o777).toBe(0o600)
	})

	test('does not preserve a partial configuration when initialization fails', async () => {
		const directory = await fixture('open-oracle-arbitrager')
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

	for (const variable of ['ZOLTAR_LIQUIDATOR_CONFIG', 'OPEN_ORACLE_ARBITRAGER_CONFIG']) {
		test(`secures the configuration selected by ${variable} without seeding the default file`, async () => {
			const directory = await fixture('liquidator')
			const selected = join(directory, '.state', 'selected.json')
			await writeFile(selected, 'selected settings')
			await chmod(selected, 0o644)

			await runEntrypoint(directory, process.env['PATH'], { [variable]: '.state/selected.json' })

			expect((await stat(selected)).mode & 0o777).toBe(0o600)
			expect(await Bun.file(join(directory, '.state', 'operator.json')).exists()).toBe(false)
		})

		test(`rejects a missing configuration selected by ${variable}`, async () => {
			const directory = await fixture('liquidator')
			await expect(runEntrypoint(directory, process.env['PATH'], { [variable]: '.state/missing.json' })).rejects.toThrow('Selected bot configuration does not exist')
			expect(await Bun.file(join(directory, '.state', 'operator.json')).exists()).toBe(false)
		})
	}

	test('rejects conflicting configuration selections', async () => {
		const directory = await fixture('liquidator')
		await expect(runEntrypoint(directory, process.env['PATH'], { OPEN_ORACLE_ARBITRAGER_CONFIG: '.state/b.json', ZOLTAR_LIQUIDATOR_CONFIG: '.state/a.json' })).rejects.toThrow('Set only one of')
	})

	test('rejects a state path that is a symbolic link or not a directory', async () => {
		const linked = await fixture('liquidator')
		const target = join(linked, 'elsewhere')
		await mkdir(target)
		await rm(join(linked, '.state'), { recursive: true })
		await symlink(target, join(linked, '.state'))
		await expect(runEntrypoint(linked)).rejects.toThrow('bot state path must be a real directory')

		const file = await fixture('liquidator')
		await rm(join(file, '.state'), { recursive: true })
		await writeFile(join(file, '.state'), 'not a directory')
		await expect(runEntrypoint(file)).rejects.toThrow('bot state path must be a real directory')
	})

	test('restricts the state directory to its owner', async () => {
		const directory = await fixture('liquidator')
		await chmod(join(directory, '.state'), 0o755)
		await runEntrypoint(directory)
		expect((await stat(join(directory, '.state'))).mode & 0o777).toBe(0o700)
	})

	test('rejects a settings file that is a symbolic link', async () => {
		const directory = await fixture('liquidator')
		const target = join(directory, 'outside.json')
		await writeFile(target, 'outside settings')
		await chmod(target, 0o644)
		await symlink(target, join(directory, '.state', 'operator.json'))
		await expect(runEntrypoint(directory)).rejects.toThrow('bot settings file must not be a symbolic link')
		expect((await stat(target)).mode & 0o777).toBe(0o644)
	})
})
