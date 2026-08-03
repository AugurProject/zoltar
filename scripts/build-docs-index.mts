import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import * as prettier from 'prettier'
import { markdownHeadingIds } from './docs-markdown-anchors.mts'
import { formatParagraphsOnSingleLines } from './format-html-prose.mts'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDirectory = path.join(repositoryRoot, 'docs')
const manifestPath = path.join(docsDirectory, 'manifest.json')
const dataOutputPath = path.join(docsDirectory, 'assets/js/docsData.js')
const categoryDirectories = ['tutorials', 'how-to', 'reference', 'explanation'] as const
const markdownSources = new Map([
	['reference/contracts.html', 'reference/contracts.md'],
	['reference/event-stream.html', 'reference/event-stream.md'],
	['reference/operator-guardrails.html', 'reference/operator-guardrails.md'],
])

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

function renderMarkdown(markdown: string): string {
	const ids = markdownHeadingIds(markdown)
	let headingIndex = 0
	return Bun.markdown.html(markdown).replace(/<h([1-6])([^>]*)>/g, (...matches) => {
		const level = matches[1]
		const attributes = matches[2]
		assert(typeof level === 'string' && typeof attributes === 'string', 'rendered Markdown heading match is malformed')
		const id = ids[headingIndex]
		headingIndex += 1
		assert(id !== undefined, 'rendered Markdown has more headings than its source')
		assert(!/\sid=/.test(attributes), 'rendered Markdown unexpectedly contains heading ids')
		return `<h${level}${attributes} id="${id}">`
	})
}

async function markdownPage(title: string, content: string, outputPath: string): Promise<string> {
	const source = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title} · Statoblast docs</title>
		<link rel="stylesheet" href="../assets/css/shared-docs.css" />
		<link rel="stylesheet" href="../assets/css/docsShell.css" />
	</head>
	<body class="doc-openoracle markdown-reference">
		<main><article>${content}</article></main>
		<script src="../assets/js/responsiveDocs.js"></script>
		<script src="../assets/js/docsData.js"></script>
		<script src="../assets/js/docsShell.js"></script>
	</body>
</html>
`
	const options = (await prettier.resolveConfig(outputPath)) ?? {}
	return formatParagraphsOnSingleLines(await prettier.format(source, { ...options, filepath: outputPath, plugins: [] }))
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

for (const [outputPath, sourcePath] of markdownSources) {
	const page = manifest.pages.find(candidate => candidate.path === outputPath)
	assert(page !== undefined, `generated Markdown route ${outputPath} is missing from docs manifest`)
	const markdown = await readFile(path.join(docsDirectory, sourcePath), 'utf8')
	const absoluteOutputPath = path.join(docsDirectory, outputPath)
	const output = await markdownPage(page.title, renderMarkdown(markdown), absoluteOutputPath)
	if (checkOnly) {
		assert.equal(await readFile(absoluteOutputPath, 'utf8').catch(() => ''), output, `${outputPath} is stale; run bun run docs:build-index`)
	} else {
		await writeFile(absoluteOutputPath, output)
	}
}

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
	const headings = Array.from(main.querySelectorAll('h2, h3'), heading => normalizedText(heading.textContent)).filter(Boolean)
	const headingOne = normalizedText(main.querySelector('h1')?.textContent)
	assert(headingOne.length > 0, `${page.path} must contain an h1`)
	const section = sectionById.get(page.section)
	assert(section !== undefined, `${page.path} has an unknown section`)
	searchIndex.push({
		fragment: '',
		headings,
		keywords: page.keywords,
		path: page.path,
		sectionTitle: section.title,
		summary: page.summary,
		text: normalizedText(main.textContent),
		title: page.title,
		topic: page.topic,
	})
	pageWindow.close()
}

const dataOutput = `// Generated by scripts/build-docs-index.mts. Do not edit directly.\nwindow.statoblastDocs = ${JSON.stringify({ ...manifest, searchIndex }, undefined, '\t')}\n`
if (checkOnly) {
	assert.equal(await readFile(dataOutputPath, 'utf8').catch(() => ''), dataOutput, 'docs/assets/js/docsData.js is stale; run bun run docs:build-index')
} else {
	await writeFile(dataOutputPath, dataOutput)
}
