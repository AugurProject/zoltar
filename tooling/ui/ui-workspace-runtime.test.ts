import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { projects } from '../repo/projects.ts'

const repositoryRoot = path.resolve(import.meta.dir, '../..')

test('all UI workspaces resolve the same Preact and signals runtime', async () => {
	for (const specifier of ['preact', 'preact/hooks', '@preact/signals']) {
		const expected = await fs.realpath(Bun.resolveSync(specifier, repositoryRoot))
		for (const project of projects.filter(project => project.path.startsWith('ui/'))) {
			expect(await fs.realpath(Bun.resolveSync(specifier, path.join(repositoryRoot, project.path)))).toBe(expected)
		}
	}
})
