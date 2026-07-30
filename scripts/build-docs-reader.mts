import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { markdownHeadingIds } from './docs-markdown-anchors.mts'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const markdownOutputPath = path.join(repositoryRoot, 'docs/assets/js/docsReaderMarkdown.js')
const documentDirectoryNames = ['architecture-deployment', 'protocol-design', 'safety-operations', 'whitepapers']
const maximumEagerReaderBytes = 250_000

type ReaderOutlineSection = {
	id: string
	kind: 'section' | 'tool'
	title: string
}

function normalizedElementText(content: string): string {
	return content.replace(/\s+/g, ' ').trim()
}

function buildOutline(relativePath: string, html: string): ReaderOutlineSection[] {
	const pageWindow = new Window()
	pageWindow.document.write(html)
	pageWindow.document.close()
	const searchRoot = pageWindow.document.querySelector('main, article') ?? pageWindow.document.body
	const sections: ReaderOutlineSection[] = []
	const sectionIds = new Set<string>()
	const indexedToolIds = new Set<string>()
	let headingIndex = 0
	let toolIndex = 0

	for (const candidate of Array.from(searchRoot.querySelectorAll('h2, .interactive-example[id]'))) {
		if (candidate.matches('h2')) {
			headingIndex += 1
			const title = normalizedElementText(candidate.textContent ?? '') || `Section ${headingIndex}`
			const containingSection = candidate.closest('section[id], article[id]')
			const id = candidate.id || containingSection?.id
			assert(id !== undefined && id.length > 0, `${relativePath} h2 "${title}" needs a stable source fragment id`)
			assert(!sectionIds.has(id), `${relativePath} h2 "${title}" reuses indexed fragment #${id}`)
			const target = pageWindow.document.getElementById(id)
			assert(target !== null, `${relativePath} h2 "${title}" indexes missing source fragment #${id}`)
			sectionIds.add(id)
			const kind = target.matches('.interactive-example[id]') ? 'tool' : 'section'
			if (kind === 'tool') indexedToolIds.add(id)
			sections.push({ id, kind, title })
			continue
		}

		if (candidate.querySelector('h2') !== null) continue
		toolIndex += 1
		const id = candidate.id
		if (id.length === 0 || indexedToolIds.has(id)) continue
		const title = normalizedElementText(candidate.querySelector('summary')?.textContent ?? candidate.getAttribute('aria-label') ?? '') || `Interactive tool ${toolIndex}`
		assert(pageWindow.document.getElementById(id) === candidate, `${relativePath} tool "${title}" indexes missing source fragment #${id}`)
		sections.push({ id, kind: 'tool', title })
	}

	pageWindow.close()
	return sections
}

async function collectReaderDocumentPaths(): Promise<string[]> {
	const runtime = await readFile(path.join(repositoryRoot, 'docs/assets/js/docsReader.js'), 'utf8')
	assert(runtime.includes("frame.loading = 'lazy'"), 'docs reader frames must load on demand')
	assert(!runtime.includes("frame.loading = 'eager'"), 'docs reader must not eagerly load the full corpus')
	assert(runtime.includes('window.docsReaderOutline'), 'docs reader must use the eager compact document outline')
	const documentPaths = Array.from(runtime.matchAll(/\n\s+path: '([^']+\.(?:html|md))',/g), match => match[1]).filter(path => path !== undefined)
	assert(documentPaths.length > 0, 'docs/assets/js/docsReader.js must declare at least one reader document')
	assert.equal(new Set(documentPaths).size, documentPaths.length, 'docs/assets/js/docsReader.js reader document paths must be unique')

	const sourceDocumentPaths = (
		await Promise.all(
			documentDirectoryNames.map(async directoryName => {
				const entries = await readdir(path.join(repositoryRoot, 'docs', directoryName), { withFileTypes: true })
				return entries.filter(entry => entry.isFile() && /\.(?:html|md)$/.test(entry.name)).map(entry => `${directoryName}/${entry.name}`)
			}),
		)
	)
		.flat()
		.toSorted()
	assert.deepEqual(documentPaths.toSorted(), sourceDocumentPaths, 'docs/assets/js/docsReader.js reader documents must exactly match the grouped documentation corpus')

	const page = await readFile(path.join(repositoryRoot, 'docs/documentation.html'), 'utf8')
	const pageWindow = new Window()
	pageWindow.document.write(page)
	pageWindow.document.close()
	const pageTitles = Array.from(pageWindow.document.querySelectorAll('head > title'), title => normalizedElementText(title.textContent))
	const pageHeadings = Array.from(pageWindow.document.querySelectorAll('body h1'), heading => normalizedElementText(heading.textContent))
	const browserTitle = normalizedElementText(pageWindow.document.title)
	pageWindow.close()
	assert.deepEqual(pageTitles, ['Statoblast documentation'], 'documentation must have one exact Statoblast browser title')
	assert.equal(browserTitle, 'Statoblast documentation', 'documentation browser title must render exactly as Statoblast documentation')
	assert.deepEqual(pageHeadings, ['Statoblast documentation'], 'documentation must have one exact outer Statoblast heading')

	const noscript = /<noscript>([\s\S]+)<\/noscript>/.exec(page)?.[1]
	assert(noscript !== undefined, 'docs/documentation.html must provide a no-JavaScript document list')
	const fallbackPaths = Array.from(noscript.matchAll(/href="\.\/([^"]+\.(?:html|md))"/g), match => match[1]).filter(path => path !== undefined)
	assert.deepEqual(fallbackPaths.toSorted(), documentPaths.toSorted(), 'documentation no-JavaScript links must match the reader corpus')
	return documentPaths
}

async function renderMarkdownDocument(relativePath: string): Promise<readonly [string, string]> {
	const markdown = await readFile(path.join(repositoryRoot, relativePath), 'utf8')
	const headingIds = markdownHeadingIds(markdown)
	let headingIndex = 0
	let renderedHtml = Bun.markdown.html(markdown)
	let insertedCharacterCount = 0
	for (const match of renderedHtml.matchAll(/<h([1-6])([^>]*)>/g)) {
		const headingId = headingIds[headingIndex]
		if (headingId === undefined) {
			throw new Error(`${relativePath} rendered more headings than its Markdown source`)
		}
		const openingTag = match[0]
		const attributes = match[2]
		const matchIndex = match.index
		if (attributes === undefined) {
			throw new Error(`${relativePath} rendered an unreadable heading tag`)
		}
		if (/\sid=/.test(attributes)) {
			throw new Error(`${relativePath} rendered an unexpected heading id before reader generation`)
		}
		headingIndex += 1
		const insertionIndex = matchIndex + openingTag.length + insertedCharacterCount - 1
		const idAttribute = ` id="${headingId}"`
		renderedHtml = `${renderedHtml.slice(0, insertionIndex)}${idAttribute}${renderedHtml.slice(insertionIndex)}`
		insertedCharacterCount += idAttribute.length
	}

	if (headingIndex !== headingIds.length) {
		throw new Error(`${relativePath} rendered ${headingIndex} of ${headingIds.length} Markdown headings`)
	}
	const renderedHeadingIds = Array.from(renderedHtml.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g), match => match[1])
	assert.deepEqual(renderedHeadingIds, headingIds, `${relativePath} reader heading ids must match validated Markdown anchors`)
	return [relativePath.replace(/^docs\//, ''), renderedHtml]
}

const documentPaths = await collectReaderDocumentPaths()
const markdownPaths = documentPaths.filter(documentPath => documentPath.endsWith('.md')).map(documentPath => `docs/${documentPath}`)
const renderedDocuments = Object.fromEntries(await Promise.all(markdownPaths.map(renderMarkdownDocument)))
const outlines = Object.fromEntries(
	await Promise.all(
		documentPaths.map(async documentPath => {
			const relativePath = `docs/${documentPath}`
			const html = documentPath.endsWith('.md') ? renderedDocuments[documentPath] : await readFile(path.join(repositoryRoot, relativePath), 'utf8')
			assert(html !== undefined, `${relativePath} must have rendered reader content`)
			return [documentPath, buildOutline(relativePath, html)] as const
		}),
	),
)

const markdownOutput = `// Generated by scripts/build-docs-reader.mts. Do not edit directly.\nwindow.docsReaderMarkdown = ${JSON.stringify(renderedDocuments)}\nwindow.docsReaderOutline = ${JSON.stringify(outlines)}\n`
assert(Buffer.byteLength(markdownOutput) <= maximumEagerReaderBytes, `docs/assets/js/docsReaderMarkdown.js exceeds its ${maximumEagerReaderBytes.toLocaleString()} byte eager-load budget`)
const checkOnly = process.argv.includes('--check')

if (checkOnly) {
	const currentMarkdown = await readFile(markdownOutputPath, 'utf8').catch(() => '')
	if (currentMarkdown !== markdownOutput) throw new Error('Documentation reader bundle is stale; run bun run docs:build-reader')
} else {
	await writeFile(markdownOutputPath, markdownOutput)
}
