import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateDocsHtml } from './check-docs-html.mts'

const repositorySource = 'https://github.com/AugurProject/zoltar/blob/main/'

test('docs HTML validation resolves repository source links against the checkout', async () => {
	const docsDirectory = await mkdtemp(path.join(tmpdir(), 'docs-html-check-'))
	try {
		await writeFile(
			path.join(docsDirectory, 'fixture.html'),
			`<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main>
				<a href="${repositorySource}solidity/contracts/Zoltar.sol#L1">present with fragment</a>
				<a href="${repositorySource}solidity/contracts/DoesNotExist.sol">missing</a>
				<a href="${repositorySource}docs/documentation.html">documentation through the repository</a>
			</main><script src="./assets/js/responsiveDocs.js"></script></body></html>`,
		)
		const failures = (await validateDocsHtml(docsDirectory)).map(failure => failure.message).filter(message => message.includes('repository'))
		expect(failures).toHaveLength(2)
		expect(failures[0]).toStartWith(`links to missing repository file "${repositorySource}solidity/contracts/DoesNotExist.sol": `)
		expect(failures[1]).toBe(`links to documentation through the repository instead of a relative route "${repositorySource}docs/documentation.html"`)
	} finally {
		await rm(docsDirectory, { force: true, recursive: true })
	}
})

test('docs HTML validation rejects an empty documentation directory', async () => {
	const docsDirectory = await mkdtemp(path.join(tmpdir(), 'docs-html-empty-'))
	try {
		await expect(validateDocsHtml(docsDirectory)).rejects.toThrow('No HTML documentation found')
	} finally {
		await rm(docsDirectory, { force: true, recursive: true })
	}
})
