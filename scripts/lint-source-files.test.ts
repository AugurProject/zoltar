import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ts from 'typescript'
import { collectSourceFiles, projectPath, parseSource } from './lint-source-files.mts'

test('source discovery retains all supported extensions and configurable rule exclusions', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lint-source-'))
	try {
		for (const directory of ['nested', 'nested/node_modules', 'generated']) await mkdir(join(root, directory), { recursive: true })
		const included = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.mts', 'h.cts', 'nested/a.d.ts']
		for (const file of [...included, 'excluded.ts', 'generated/a.ts', 'nested/node_modules/a.ts', 'notes.txt']) await writeFile(join(root, file), '')
		expect((await collectSourceFiles(root, ['generated'], new Set(['excluded.ts']))).map(file => projectPath(root, file)).sort()).toEqual(included.sort())
		expect((await collectSourceFiles(root, [], new Set())).map(file => projectPath(root, file))).toContain('generated/a.ts')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('parsing preserves JavaScript versus historical catch-rule TypeScript mode', () => {
	expect(parseSource('a.jsx', 'const x = <p />').languageVariant).toBe(ts.LanguageVariant.JSX)
	expect(parseSource('a.js', 'const x = 1').flags & ts.NodeFlags.JavaScriptFile).not.toBe(0)
	expect(parseSource('a.js', 'const x = 1', true).flags & ts.NodeFlags.JavaScriptFile).toBe(0)
})
