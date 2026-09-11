import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateDocsHtml } from './check-docs-html.mts'

const repositorySource = 'https://github.com/AugurProject/zoltar/blob/main/'

test('docs HTML validation resolves repository source links against the checkout', async () => {
	const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'docs-html-check-'))
	const docsDirectory = path.join(fixtureRoot, 'docs')
	try {
		await mkdir(path.join(docsDirectory, 'assets'), { recursive: true })
		await writeFile(
			path.join(docsDirectory, 'fixture.html'),
			`<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main>
				<a href="${repositorySource}solidity/contracts/Zoltar.sol#L1">present with fragment</a>
				<a href="${repositorySource}solidity/contracts/DoesNotExist.sol">missing</a>
				<a href="${repositorySource}docs/documentation.html">documentation through the repository</a>
				<a href="../outside.json">relative link that escapes the documentation directory</a>
				<a href="./assets/addresses.json#entry">relative link inside the documentation directory</a>
			</main><script src="./assets/js/responsiveDocs.js"></script></body></html>`,
		)
		await writeFile(path.join(fixtureRoot, 'outside.json'), '{}')
		await writeFile(path.join(docsDirectory, 'assets', 'addresses.json'), '{}')
		const failures = (await validateDocsHtml(docsDirectory)).map(failure => failure.message).filter(message => message.includes('repository') || message.includes('documentation directory'))
		expect(failures).toHaveLength(3)
		expect(failures[0]).toStartWith(`links to missing repository file "${repositorySource}solidity/contracts/DoesNotExist.sol": `)
		expect(failures[1]).toBe(`links to documentation through the repository instead of a relative route "${repositorySource}docs/documentation.html"`)
		expect(failures[2]).toBe('links outside the documentation directory "../outside.json"; link repository files through their GitHub source URL')
	} finally {
		await rm(fixtureRoot, { force: true, recursive: true })
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
