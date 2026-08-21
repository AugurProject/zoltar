import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { shareUiPreactRuntime } from './share-ui-preact-runtime.mjs'

test('UI frozen installs share the repository Preact runtime', async () => {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-ui-runtime-'))
	const rootPreact = path.join(repositoryRoot, 'node_modules', 'preact')
	const appPreact = path.join(repositoryRoot, 'ui', 'trading', 'node_modules', 'preact')
	try {
		await mkdir(rootPreact, { recursive: true })
		await mkdir(appPreact, { recursive: true })
		await writeFile(path.join(rootPreact, 'package.json'), '{"name":"preact"}\n')
		await writeFile(path.join(appPreact, 'package.json'), '{"name":"stale-preact"}\n')

		expect(shareUiPreactRuntime(path.join(repositoryRoot, 'ui', 'trading'))).toBeTrue()
		expect(await realpath(appPreact)).toBe(await realpath(rootPreact))
		expect(await readFile(path.join(appPreact, 'package.json'), 'utf8')).toContain('"preact"')
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true })
	}
})

test('non-UI installs are left unchanged', () => {
	expect(shareUiPreactRuntime(path.join(tmpdir(), 'zoltar', 'shared'))).toBeFalse()
})
