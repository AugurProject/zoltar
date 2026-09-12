import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { preactSingletonDependencyPaths, shareUiPreactRuntime } from './share-ui-preact-runtime.mjs'

test('UI frozen installs share the repository Preact runtime', async () => {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-ui-runtime-'))
	const appRoot = path.join(repositoryRoot, 'ui', 'trading')
	try {
		for (const dependencyPath of preactSingletonDependencyPaths) {
			const rootDependency = path.join(repositoryRoot, 'node_modules', dependencyPath)
			const appDependency = path.join(appRoot, 'node_modules', dependencyPath)
			await mkdir(rootDependency, { recursive: true })
			await mkdir(appDependency, { recursive: true })
			await writeFile(path.join(rootDependency, 'package.json'), `${JSON.stringify({ name: dependencyPath })}\n`)
			await writeFile(path.join(appDependency, 'package.json'), `${JSON.stringify({ name: `stale-${dependencyPath}` })}\n`)
		}

		expect(shareUiPreactRuntime(appRoot)).toBeTrue()
		for (const dependencyPath of preactSingletonDependencyPaths) {
			const rootDependency = path.join(repositoryRoot, 'node_modules', dependencyPath)
			const appDependency = path.join(appRoot, 'node_modules', dependencyPath)
			expect(await realpath(appDependency)).toBe(await realpath(rootDependency))
			expect(await readFile(path.join(appDependency, 'package.json'), 'utf8')).toContain(JSON.stringify(dependencyPath))
		}
		expect(shareUiPreactRuntime(appRoot)).toBeFalse()
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true })
	}
})

test('non-UI installs are left unchanged', () => {
	expect(shareUiPreactRuntime(path.join(tmpdir(), 'zoltar', 'shared'))).toBeFalse()
})
