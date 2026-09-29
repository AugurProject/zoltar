import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFileDurably, contentRevision, durableFilesystem, parseJsonDocument, readFileIfPresent, serializeWritesToPath, writeFileAtomically, writeRevisionedFile, type DurableAppendFilesystem, type DurableWriteFilesystem } from '../../src/config/durable-file.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-durable-file-'))
	temporaryDirectories.push(directory)
	return directory
}

function recordingFilesystem(events: string[], failure?: string): DurableWriteFilesystem {
	const operation = async (name: string) => {
		events.push(name)
		if (failure === name) throw new Error(`${name} failed`)
	}
	return {
		mkdir: async (path, options) => {
			expect([path, options]).toEqual(['/state', { mode: 0o700, recursive: true }])
			await operation('mkdir')
		},
		open: async (path, flags, mode) => {
			const target = flags === 'r' ? 'directory' : 'file'
			if (flags === 'r') expect(path).toBe('/state')
			else expect([path.startsWith('/state/settings.json.') && path.endsWith('.tmp'), mode]).toEqual([true, 0o600])
			await operation(`${target}:open`)
			return {
				chmod: async mode => {
					expect(mode).toBe(0o600)
					await operation(`${target}:chmod`)
				},
				close: () => operation(`${target}:close`),
				sync: () => operation(`${target}:sync`),
				writeFile: async (data, options) => {
					expect([data, options]).toEqual(['contents', { encoding: 'utf8' }])
					await operation(`${target}:write`)
				},
			}
		},
		rename: async (source, target) => {
			expect(source.endsWith('.tmp')).toBe(true)
			expect(target).toBe('/state/settings.json')
			await operation('rename')
		},
		rm: async (path, options) => {
			expect([path.endsWith('.tmp'), options]).toEqual([true, { force: true }])
			events.push('rm')
		},
	}
}

const committedEvents = ['mkdir', 'file:open', 'file:write', 'file:chmod', 'file:sync', 'file:close', 'rename', 'directory:open', 'directory:sync', 'directory:close']

test('atomic writes sync the file before the rename and the directory after it', async () => {
	const events: string[] = []
	await writeFileAtomically('/state/settings.json', 'contents', { filesystem: recordingFilesystem(events) })
	expect(events).toEqual(committedEvents)
})

// A failed write or sync still closes its open handle before cleanup; a failed open has no handle to close.
for (const { failure, closesAfterFailure } of [
	{ failure: 'file:open', closesAfterFailure: [] },
	{ failure: 'file:write', closesAfterFailure: ['file:close'] },
	{ failure: 'file:sync', closesAfterFailure: ['file:close'] },
	{ failure: 'rename', closesAfterFailure: [] },
	{ failure: 'directory:open', closesAfterFailure: [] },
	{ failure: 'directory:sync', closesAfterFailure: ['directory:close'] },
	{ failure: 'directory:close', closesAfterFailure: [] },
]) {
	test(`atomic writes propagate a ${failure} failure and remove the temporary file`, async () => {
		const events: string[] = []
		await expect(writeFileAtomically('/state/settings.json', 'contents', { filesystem: recordingFilesystem(events, failure) })).rejects.toThrow(`${failure} failed`)
		expect(events).toEqual([...committedEvents.slice(0, committedEvents.indexOf(failure) + 1), ...closesAfterFailure, 'rm'])
	})
}

test('a pre-commit check can abort the replacement and keep the destination', async () => {
	const directory = await temporaryDirectory()
	const path = join(directory, 'state.json')
	await writeFileAtomically(path, 'previous')
	const problem = new Error('temporary file failed validation')
	let validated = ''
	await expect(
		writeFileAtomically(path, 'next', {
			beforeCommit: async temporaryPath => {
				validated = await readFile(temporaryPath, 'utf8')
				throw problem
			},
		}),
	).rejects.toBe(problem)
	expect(validated).toBe('next')
	expect(await readFile(path, 'utf8')).toBe('previous')
	expect(await readdir(directory)).toEqual(['state.json'])
})

test('atomic writes create owner-only files and directories', async () => {
	const directory = await temporaryDirectory()
	const path = join(directory, 'nested', 'state.json')
	await writeFile(join(directory, 'permissive.json'), 'old', { mode: 0o644 })
	await writeFileAtomically(path, 'contents')
	await writeFileAtomically(join(directory, 'permissive.json'), 'new')
	expect((await stat(join(directory, 'nested'))).mode & 0o777).toBe(0o700)
	expect((await stat(path)).mode & 0o777).toBe(0o600)
	expect((await stat(join(directory, 'permissive.json'))).mode & 0o777).toBe(0o600)
	expect(await readFile(path, 'utf8')).toBe('contents')
})

test('durable directory creation syncs the parent of every directory it creates before writing', async () => {
	const events: string[] = []
	let created = false
	await writeFileAtomically('/durable/a/operator/deployment.json', 'contents', {
		filesystem: {
			mkdir: async path => {
				created = true
				events.push(`mkdir:${path}`)
			},
			open: async (path, flags) => {
				if (flags === 'r' && !created && (path === '/durable/a/operator' || path === '/durable/a')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
				if (flags === 'wx') events.push('open-file')
				return { chmod: async () => undefined, close: async () => undefined, sync: async () => events.push(`sync:${path}`), writeFile: async () => undefined }
			},
			rename: async () => undefined,
			rm: async () => undefined,
		},
		syncCreatedDirectories: true,
	})
	expect(events.slice(0, 4)).toEqual(['mkdir:/durable/a/operator', 'sync:/durable/a', 'sync:/durable', 'open-file'])
	expect(events.at(-1)).toBe('sync:/durable/a/operator')
})

test('revisioned writes return the saved revision and reject a changed or missing destination at commit time', async () => {
	const directory = await temporaryDirectory()
	const path = join(directory, 'settings.json')
	const conflict = () => new Error('revision conflict')
	const first = await writeRevisionedFile(path, 'first', { conflict })
	expect(first).toBe(contentRevision('first'))
	expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
	expect(await writeRevisionedFile(path, 'second', { conflict, expectedRevision: first })).toBe(contentRevision('second'))
	let replaced = false
	const racingFilesystem = {
		...durableFilesystem,
		readFile: async (readPath: string, encoding: 'utf8') => {
			if (!replaced) {
				replaced = true
				await writeFile(path, 'external')
			}
			return await readFile(readPath, encoding)
		},
	}
	await expect(writeRevisionedFile(path, 'third', { conflict, expectedRevision: contentRevision('second'), filesystem: racingFilesystem })).rejects.toThrow('revision conflict')
	expect(await readFile(path, 'utf8')).toBe('external')
	await rm(path)
	await expect(writeRevisionedFile(path, 'fourth', { conflict, expectedRevision: contentRevision('external') })).rejects.toThrow('revision conflict')
	expect(await readFileIfPresent(path)).toBeUndefined()
	expect(await readdir(directory)).toEqual([])
})

test('appends sync the owner-only file and then its directory', async () => {
	const events: string[] = []
	const filesystem: DurableAppendFilesystem = {
		mkdir: async () => events.push('mkdir'),
		open: async (path, flags, mode) => {
			const target = flags === 'r' ? 'directory' : 'file'
			expect([path, mode]).toEqual(flags === 'r' ? ['/state', undefined] : ['/state/history.jsonl', 0o600])
			return {
				appendFile: async (data, options) => events.push(`${target}:append:${data}:${options.encoding}`),
				chmod: async mode => events.push(`${target}:chmod:${mode.toString(8)}`),
				close: async () => events.push(`${target}:close`),
				sync: async () => events.push(`${target}:sync`),
			}
		},
	}
	await appendFileDurably('/state/history.jsonl', 'line\n', filesystem)
	expect(events).toEqual(['mkdir', 'file:chmod:600', 'file:append:line\n:utf8', 'file:sync', 'file:close', 'directory:sync', 'directory:close'])
	events.length = 0
	await appendFileDurably('/state/history.jsonl', undefined, filesystem)
	expect(events).toEqual(['mkdir', 'file:chmod:600', 'file:sync', 'file:close', 'directory:sync', 'directory:close'])
})

test('appends preserve earlier lines and restore owner-only mode', async () => {
	const directory = await temporaryDirectory()
	const path = join(directory, 'history.jsonl')
	await writeFile(path, 'first\n', { mode: 0o644 })
	await appendFileDurably(path, 'second\n')
	expect(await readFile(path, 'utf8')).toBe('first\nsecond\n')
	expect((await stat(path)).mode & 0o777).toBe(0o600)
})

test('path write queues run same-path operations one at a time in call order', async () => {
	const directory = await temporaryDirectory()
	const events: string[] = []
	let releaseFirst: () => void = () => undefined
	const firstGate = new Promise<void>(resolve => {
		releaseFirst = resolve
	})
	const first = serializeWritesToPath(join(directory, 'state.json'), async () => {
		events.push('first:start')
		await firstGate
		events.push('first:end')
		throw new Error('first failed')
	})
	const second = serializeWritesToPath(join(directory, '.', 'state.json'), async () => {
		events.push('second')
		return 'second result'
	})
	const other = serializeWritesToPath(join(directory, 'other.json'), async () => {
		events.push('other')
	})
	await other
	expect(events).toEqual(['first:start', 'other'])
	releaseFirst()
	await expect(first).rejects.toThrow('first failed')
	await expect(second).resolves.toBe('second result')
	expect(events).toEqual(['first:start', 'other', 'first:end', 'second'])
})

test('JSON documents report the labelled syntax error', () => {
	expect(parseJsonDocument('{"a":1}', 'Operator configuration')).toEqual({ a: 1 })
	expect(() => parseJsonDocument('{', 'Operator configuration')).toThrow('Operator configuration is not valid JSON:')
})
