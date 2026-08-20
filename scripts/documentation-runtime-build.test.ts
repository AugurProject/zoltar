import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildDocumentationRuntime, documentationRuntimeNames, findStaleDocumentationRuntime } from './documentationRuntimeBuild.mts'

test('documentation runtime generation is deterministic and reports stale browser output', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-doc-runtime-'))
	const sourceRoot = path.join(temporaryRoot, 'runtime')
	const outputRoot = path.join(temporaryRoot, 'assets')
	try {
		await Promise.all([mkdir(sourceRoot), mkdir(outputRoot)])
		for (const name of documentationRuntimeNames) {
			await writeFile(path.join(sourceRoot, `${name}.ts`), `(() => { const runtimeName: string = '${name}'; window.dataset = runtimeName })()\n`)
			await writeFile(path.join(outputRoot, `${name}.js`), await buildDocumentationRuntime(name, sourceRoot))
		}
		expect(await findStaleDocumentationRuntime(sourceRoot, outputRoot)).toEqual([])
		await writeFile(path.join(outputRoot, 'docsShell.js'), '// deliberately stale temporary fixture\n')
		expect(await findStaleDocumentationRuntime(sourceRoot, outputRoot)).toEqual(['docsShell'])
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true })
	}
})
