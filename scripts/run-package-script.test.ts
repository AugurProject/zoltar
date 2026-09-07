import { expect, test } from 'bun:test'
import path from 'node:path'
import { resolvePackageRoot } from './run-package-script.mts'

test('package runner resolves only repository packages', async () => {
	const repositoryRoot = path.resolve(import.meta.dir, '..')
	await expect(resolvePackageRoot(repositoryRoot, 'bots/chaos')).resolves.toBe(path.join(repositoryRoot, 'bots/chaos'))
	await expect(resolvePackageRoot(repositoryRoot, '../outside')).rejects.toThrow('escapes the repository')
	await expect(resolvePackageRoot(repositoryRoot, 'missing-package')).rejects.toThrow('has no package.json')
})
