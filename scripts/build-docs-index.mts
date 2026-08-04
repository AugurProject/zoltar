import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDirectory = path.join(repositoryRoot, 'docs')
const manifestPath = path.join(docsDirectory, 'manifest.json')
const dataOutputPath = path.join(docsDirectory, 'assets/js/docsData.js')
const searchDataOutputPath = path.join(docsDirectory, 'assets/js/docsSearchData.js')
const categoryDirectories = ['tutorials', 'how-to', 'reference', 'explanation'] as const

type DocsSection = {
	id: string
	title: string
	description: string
}

type DocsPage = {
	path: string
	title: string
	summary: string
	section: string
	topic: string
	keywords: string[]
}

type DocsManifest = {
	sections: DocsSection[]
	pages: DocsPage[]
}

function normalizedText(value: string | null | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim()
}

function assertManifest(value: unknown): asserts value is DocsManifest {
	assert(typeof value === 'object' && value !== null, 'docs/manifest.json must contain an object')
	const candidate = value as Partial<DocsManifest>
	assert(Array.isArray(candidate.sections) && candidate.sections.length === 4, 'docs manifest must declare the four Diátaxis sections')
	assert(Array.isArray(candidate.pages) && candidate.pages.length > 0, 'docs manifest must declare pages')
	const sectionIds = new Set<string>(candidate.sections.map(section => section.id))
	assert.deepEqual(sectionIds, new Set<string>(categoryDirectories), 'docs manifest sections must be tutorials, how-to, reference, and explanation')
	const paths = new Set<string>()
	for (const page of candidate.pages) {
		assert(page.path.endsWith('.html'), `docs manifest page ${page.path} must be an HTML route`)
		assert(sectionIds.has(page.section), `docs manifest page ${page.path} has unknown section ${page.section}`)
		assert(page.path.startsWith(`${page.section}/`), `docs manifest page ${page.path} must live under its Diátaxis section`)
		assert(!paths.has(page.path), `docs manifest repeats ${page.path}`)
		assert(normalizedText(page.title).length > 0, `docs manifest page ${page.path} needs a title`)
		assert(normalizedText(page.summary).length > 0, `docs manifest page ${page.path} needs a summary`)
		assert(normalizedText(page.topic).length > 0, `docs manifest page ${page.path} needs a topic`)
		assert(Array.isArray(page.keywords), `docs manifest page ${page.path} needs keywords`)
		paths.add(page.path)
	}
}

async function filesIn(directory: string): Promise<string[]> {
	const entries = await readdir(path.join(docsDirectory, directory), { withFileTypes: true })
	return entries.filter(entry => entry.isFile() && entry.name.endsWith('.html')).map(entry => `${directory}/${entry.name}`)
}

const checkOnly = process.argv.includes('--check')
const manifestValue: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
assertManifest(manifestValue)
const manifest = manifestValue
const sectionById = new Map(manifest.sections.map(section => [section.id, section]))
const isMarkdownPath = (filePath: string) => ['.md', '.markdown'].includes(path.extname(filePath).toLowerCase())
assert.equal(isMarkdownPath('reference/example.MD'), true, 'uppercase Markdown extensions must be rejected')
assert.equal(isMarkdownPath('reference/example.MarkDown'), true, 'long Markdown extensions must be rejected case-insensitively')
assert.equal(isMarkdownPath('reference/example.html'), false, 'HTML documentation must remain allowed')
const markdownPaths = [...new Bun.Glob('**/*').scanSync({ cwd: docsDirectory, onlyFiles: true })].filter(isMarkdownPath).toSorted()
assert.deepEqual(markdownPaths, [], 'docs must use canonical HTML sources; convert and remove Markdown files')

const landingSource = await readFile(path.join(docsDirectory, 'documentation.html'), 'utf8')
const landingWindow = new Window({ url: 'https://docs.statoblast.test/documentation.html' })
landingWindow.document.write(landingSource)
landingWindow.document.close()
for (const [sectionId, landingSectionId] of [
	['tutorials', 'tutorials'],
	['how-to', 'how-to-guides'],
	['reference', 'reference'],
	['explanation', 'explanation'],
] as const) {
	const landingSection = landingWindow.document.querySelector(`#${landingSectionId}`)
	assert(landingSection !== null, `documentation.html must contain the ${landingSectionId} landing section`)
	const links = Array.from(landingSection.querySelectorAll('a[href]'))
	assert(links.length > 0, `documentation.html ${landingSectionId} must feature at least one page`)
	for (const link of links) {
		const route = link.getAttribute('href')?.replace(/^\.\//, '')
		assert(route !== undefined, `documentation.html ${landingSectionId} contains a link without a route`)
		const page = manifest.pages.find(candidate => candidate.path === route)
		assert(page !== undefined, `documentation.html links to ${route}, which is absent from docs/manifest.json`)
		assert.equal(page.section, sectionId, `documentation.html lists ${route} in the wrong Diátaxis section`)
		assert.equal(normalizedText(link.textContent), page.title, `documentation.html label for ${route} must match its manifest title`)
	}
}
landingWindow.close()

const actualPagePaths = (await Promise.all(categoryDirectories.map(filesIn))).flat().toSorted()
assert.deepEqual(actualPagePaths, manifest.pages.map(page => page.path).toSorted(), 'docs manifest pages must exactly match HTML pages in the four Diátaxis directories')

const searchIndex = []
for (const page of manifest.pages) {
	const source = await readFile(path.join(docsDirectory, page.path), 'utf8')
	const pageWindow = new Window()
	pageWindow.document.write(source)
	pageWindow.document.close()
	for (const [selector, attribute, expectedValue] of [
		['link[rel~="stylesheet"]', 'href', '../assets/css/docsShell.css'],
		['script[src]', 'src', '../assets/js/docsData.js'],
		['script[src]', 'src', '../assets/js/docsShell.js'],
	] as const) {
		const matches = Array.from(pageWindow.document.querySelectorAll(selector)).filter(element => element.getAttribute(attribute) === expectedValue)
		assert.equal(matches.length, 1, `${page.path} must load ${expectedValue} exactly once`)
	}
	const main = pageWindow.document.querySelector('main')
	assert(main !== null, `${page.path} must contain main documentation content`)
	const headingOne = normalizedText(main.querySelector('h1')?.textContent)
	assert(headingOne.length > 0, `${page.path} must contain an h1`)
	const section = sectionById.get(page.section)
	assert(section !== undefined, `${page.path} has an unknown section`)
	let currentChunk: { fragment: string; heading: string; text: string[] } = { fragment: '', heading: '', text: [] }
	const searchChunks = [currentChunk]
	const walker = pageWindow.document.createTreeWalker(main, pageWindow.NodeFilter.SHOW_ELEMENT | pageWindow.NodeFilter.SHOW_TEXT)
	let node = walker.nextNode()
	while (node !== null) {
		if (node instanceof pageWindow.HTMLElement && node.matches('h2, h3')) {
			const heading = normalizedText(node.textContent)
			const fragment = node.id || node.closest('[id]')?.getAttribute('id') || ''
			assert(heading.length > 0, `${page.path} contains an empty search heading`)
			assert(fragment.length > 0, `${page.path} heading ${heading} needs an id or an ancestor id`)
			currentChunk = { fragment, heading, text: [] }
			searchChunks.push(currentChunk)
		} else if (node.nodeType === pageWindow.Node.TEXT_NODE && node.parentElement?.closest('h1, h2, h3') === null) {
			const text = normalizedText(node.textContent)
			if (text.length > 0) currentChunk.text.push(text)
		}
		node = walker.nextNode()
	}
	for (const [index, chunk] of searchChunks.entries())
		searchIndex.push({
			fragment: chunk.fragment,
			heading: chunk.heading,
			keywords: index === 0 ? page.keywords : [],
			path: page.path,
			sectionTitle: section.title,
			summary: page.summary,
			text: chunk.text.join(' '),
			title: page.title,
			topic: page.topic,
			weight: index === 0 ? 1 : 0,
		})
	pageWindow.close()
}

const dataOutput = `// Generated by scripts/build-docs-index.mts. Do not edit directly.\nwindow.statoblastDocs = ${JSON.stringify(manifest)}\n`
const searchDataOutput = `// Generated by scripts/build-docs-index.mts. Loaded on demand; do not edit directly.\nwindow.statoblastDocsSearch = ${JSON.stringify(searchIndex)}\n`
if (checkOnly) {
	assert.equal(await readFile(dataOutputPath, 'utf8').catch(() => ''), dataOutput, 'docs/assets/js/docsData.js is stale; run bun run docs:build-index')
	assert.equal(await readFile(searchDataOutputPath, 'utf8').catch(() => ''), searchDataOutput, 'docs/assets/js/docsSearchData.js is stale; run bun run docs:build-index')
} else {
	await writeFile(dataOutputPath, dataOutput)
	await writeFile(searchDataOutputPath, searchDataOutput)
}
