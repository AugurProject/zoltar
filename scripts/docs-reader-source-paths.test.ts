import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveDocumentReference } from './check-docs-html.mts'
import { collectGroupedDocumentPaths } from './docs-reader-source-paths.ts'

test('grouped documentation discovery includes nested HTML and Markdown documents', async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'zoltar-doc-reader-paths-'))
	try {
		await mkdir(path.join(temporaryDirectory, 'whitepapers', 'appendices'), { recursive: true })
		await mkdir(path.join(temporaryDirectory, 'protocol-design'), { recursive: true })
		await writeFile(path.join(temporaryDirectory, 'whitepapers', 'paper.html'), '<h1>Paper</h1>')
		await writeFile(path.join(temporaryDirectory, 'whitepapers', 'appendices', 'math.md'), '# Math')
		await writeFile(path.join(temporaryDirectory, 'whitepapers', 'appendices', 'notes.txt'), 'ignored')
		await writeFile(path.join(temporaryDirectory, 'protocol-design', 'mechanism.html'), '<h1>Mechanism</h1>')

		expect(await collectGroupedDocumentPaths(temporaryDirectory, ['whitepapers', 'protocol-design'])).toEqual(['protocol-design/mechanism.html', 'whitepapers/appendices/math.md', 'whitepapers/paper.html'])
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true })
	}
})

test('nested HTML assets resolve against the document location to the shared docs asset root', () => {
	const nestedDocument = path.join('/repository', 'docs', 'whitepapers', 'appendices', 'math.html')
	expect(resolveDocumentReference(nestedDocument, '../../assets/css/shared-docs.css')).toBe(path.join('/repository', 'docs', 'assets', 'css', 'shared-docs.css'))
	expect(resolveDocumentReference(nestedDocument, '../../assets/js/responsiveDocs.js')).toBe(path.join('/repository', 'docs', 'assets', 'js', 'responsiveDocs.js'))
})
