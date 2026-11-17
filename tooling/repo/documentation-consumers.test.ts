import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { classifyCiChange, isDocumentationChange } from '../ci/classify-ci-change.mts'
import { getTestImpactRecommendations } from '../testing/test-impact.mts'
import { documentationConsumerMatches, documentationConsumers } from './documentation-consumers.ts'
import { listRepositoryFiles } from './git.mts'
import { projects } from './projects.ts'

const repositoryFiles = listRepositoryFiles().filter(filePath => filePath !== '')
const repositoryFileSet = new Set(repositoryFiles)

const scopeFor = (projectId: string) => {
	const scope = projects.find(project => project.id === projectId)?.ci?.scope
	if (scope === undefined) throw new Error(`Documentation consumer ${projectId} has no CI scope`)
	return scope
}

const isConsumedDocumentation = (filePath: string) => (filePath.startsWith('docs/') && /\.(?:html|md)$/.test(filePath)) || filePath === 'README.md' || filePath.endsWith('/README.md')

const expectConsumedBy = (readPath: string, testPath: string) => expect({ readPath, testPath, consumed: documentationConsumers.some(consumer => consumer.tests?.includes(testPath) === true && documentationConsumerMatches(consumer, readPath)) }).toEqual({ readPath, testPath, consumed: true })

/** Repository documentation paths a test source reads through literal paths, page URLs, or `join(...)` segments. */
const documentationReadPaths = (source: string) => {
	const literalReads = [...source.matchAll(/(?:Bun\.file|readFile|loadDocument)\(\s*'([^']+)'/g)].map(match => match[1] ?? '')
	// loadShell reads `docs/<route>` for the page URL it is given, including its default URL.
	const shellReads = [...source.matchAll(/(?:loadShell\(|url = )\s*'http:\/\/localhost\/docs\/([^'#?]+)/g)].map(match => `docs/${match[1] ?? ''}`)
	const joinedReads = [...source.matchAll(/\bjoin\(\s*[A-Za-z_$][\w$]*((?:\s*,\s*'[^']*')+)\s*\)/g)].map(match => [...(match[1] ?? '').matchAll(/'([^']*)'/g)].map(segment => segment[1] ?? '').join('/'))
	return [...literalReads, ...shellReads, ...joinedReads].filter(readPath => isConsumedDocumentation(readPath) && repositoryFileSet.has(readPath))
}

test.each(documentationConsumers.map(consumer => [consumer.reason, consumer] as const))('CI classification and test impact agree when %s', (_reason, consumer) => {
	const tests = consumer.tests ?? []
	const checks = consumer.checks ?? []
	expect(tests.length + checks.length).toBeGreaterThan(0)
	for (const testPath of tests) expect(existsSync(testPath)).toBe(true)
	const samplePaths = [...(consumer.files ?? []), ...(consumer.directories ?? []).map(directory => repositoryFiles.find(filePath => filePath.startsWith(directory))), ...(consumer.pattern === undefined ? [] : [repositoryFiles.find(filePath => consumer.pattern?.test(filePath) === true)])]
	for (const samplePath of samplePaths) {
		if (samplePath === undefined) throw new Error(`Documentation consumer for ${consumer.projectId} matches no repository file`)
		expect(existsSync(samplePath)).toBe(true)
		expect(isDocumentationChange(samplePath)).toBe(true)
		expect(classifyCiChange([samplePath]).expandedScopes).toContain(scopeFor(consumer.projectId))
		const recommended = getTestImpactRecommendations([samplePath]).map(recommendation => recommendation.command)
		for (const testPath of tests) expect(recommended.join('\n')).toContain(testPath.replace(/^(?:augurScan|bots\/[^/]+)\//, ''))
		for (const check of checks) expect(recommended).toContain(check)
	}
})

test('every documentation page a root tooling test reads selects a consumer that runs that test', () => {
	// This file is excluded because its scan fixtures quote reads it never performs.
	const reads = repositoryFiles.filter(filePath => filePath.startsWith('tooling/') && filePath.endsWith('.test.ts') && filePath !== 'tooling/repo/documentation-consumers.test.ts').flatMap(testPath => documentationReadPaths(readFileSync(testPath, 'utf8')).map(readPath => ({ readPath, testPath })))
	expect(reads.length).toBeGreaterThan(0)
	for (const { readPath, testPath } of reads) expectConsumedBy(readPath, testPath)
})

test('the read scan finds literal, page-URL, and joined-segment documentation reads', () => {
	const source = [
		"Bun.file('docs/reference/invariants.html')",
		"loadShell('http://localhost/docs/documentation.html#how-to')",
		"async function loadShell(url = 'http://localhost/docs/explanation/open-oracle.html')",
		"join(repositoryRoot, 'README.md')",
		"join(repositoryRoot, 'testnetwork', 'README.md')",
		"join(temporaryDirectory, 'unsafe.html')",
	].join('\n')
	expect(documentationReadPaths(source)).toEqual(['docs/reference/invariants.html', 'docs/documentation.html', 'docs/explanation/open-oracle.html', 'README.md', 'testnetwork/README.md'])
})

test('the documentation shell pager page at the first manifest section boundary selects the shell runtime test', () => {
	const manifest: unknown = JSON.parse(readFileSync('docs/manifest.json', 'utf8'))
	const sections: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'sections') : undefined
	const pages: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'pages') : undefined
	if (!Array.isArray(sections) || !Array.isArray(pages)) throw new Error('docs/manifest.json must list sections and pages')
	// Mirrors the sidebar reading order docs-shell-runtime.test.ts follows: sections in order, pages grouped by topic.
	const order = sections.flatMap(section => {
		const topics = new Map<string, { path: string; section: string }[]>()
		for (const page of pages) {
			if (Reflect.get(page, 'section') !== Reflect.get(section, 'id')) continue
			const topic = String(Reflect.get(page, 'topic'))
			topics.set(topic, [...(topics.get(topic) ?? []), { path: String(Reflect.get(page, 'path')), section: String(Reflect.get(page, 'section')) }])
		}
		return Array.from(topics.values()).flat()
	})
	const boundaryPage = order.find((page, index) => order[index + 1] !== undefined && order[index + 1]?.section !== page.section)
	if (boundaryPage === undefined) throw new Error('The manifest needs two non-empty sections')
	expectConsumedBy(`docs/${boundaryPage.path}`, 'tooling/docs/docs-shell-runtime.test.ts')
})
