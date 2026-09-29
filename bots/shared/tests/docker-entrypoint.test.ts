import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

async function runEntrypoint(directory: string, path = process.env['PATH']) {
	const child = Bun.spawn([entrypoint, '/bin/true'], { cwd: directory, env: { ...process.env, PATH: path }, stderr: 'pipe', stdout: 'pipe' })
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
})
