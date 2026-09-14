import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { walkFiles } from './walk.mts'
import { repositoryRoot } from './root.mts'

test('walkFiles preserves caller filters and does not follow symlink cycles', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'repo-walk-'))
	try {
		await mkdir(path.join(root, 'nested'))
		await mkdir(path.join(root, 'excluded'))
		await writeFile(path.join(root, 'nested', 'keep.sol'), '')
		await writeFile(path.join(root, 'nested', 'skip.txt'), '')
		await writeFile(path.join(root, 'excluded', 'skip.sol'), '')
		await symlink(root, path.join(root, 'loop'))
		expect(await walkFiles(root, { descend: (_directory, entry) => entry.name !== 'excluded', include: file => file.endsWith('.sol') })).toEqual([path.join(root, 'nested', 'keep.sol')])
		expect(await walkFiles(root)).not.toContain(path.join(root, 'loop'))
		expect(await walkFiles(root, { includeNonFiles: true })).toContain(path.join(root, 'loop'))
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('repositoryRoot resolves from its module location', async () => {
	expect(await Bun.file(path.join(repositoryRoot, 'package.json')).json()).toMatchObject({ name: 'zoltar' })
})
