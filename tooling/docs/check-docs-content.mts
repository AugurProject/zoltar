import assert from 'node:assert/strict'
import { htmlToDocumentationText } from './docs-html-text.mts'

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ')
const parsedHtmlParagraphBodies = async (text: string, excludedContainers = 'script, style, template, noscript') => {
	const paragraphs: string[] = []
	let excludedDepth = 0
	let currentParagraph: string[] | undefined
	const rewriter = new HTMLRewriter()
		.on(excludedContainers, {
			element(element) {
				excludedDepth += 1
				element.onEndTag(() => {
					excludedDepth -= 1
				})
			},
		})
		.on('p', {
			element(element) {
				if (excludedDepth > 0) {
					return
				}
				const paragraph: string[] = []
				currentParagraph = paragraph
				element.onEndTag(() => {
					paragraphs.push(paragraph.join(''))
					if (currentParagraph === paragraph) {
						currentParagraph = undefined
					}
				})
			},
			text(chunk) {
				if (excludedDepth === 0) {
					currentParagraph?.push(chunk.text)
				}
			},
		})
	await rewriter.transform(new Response(text)).text()
	return paragraphs
}

const parsedHtmlFormulaSources = async (text: string) => {
	const formulas: string[] = []
	let excludedDepth = 0
	const rewriter = new HTMLRewriter()
		.on('script, style, template, noscript', {
			element(element) {
				excludedDepth += 1
				element.onEndTag(() => {
					excludedDepth -= 1
				})
			},
		})
		.on('math[data-source]', {
			element(element) {
				if (excludedDepth > 0) {
					return
				}
				const formula = element.getAttribute('data-source')
				if (formula !== null) {
					formulas.push(formula)
				}
			},
		})
	await rewriter.transform(new Response(text)).text()
	return formulas
}

const assertFormulaMetadataUnchanged = async (expectedHtml: string, candidateHtml: string) => {
	assert.deepEqual(await parsedHtmlFormulaSources(candidateHtml), await parsedHtmlFormulaSources(expectedHtml), 'Machine-readable formula metadata changed')
}

const formulaMetadataFixture = '<p>Vault owners earn fees.</p><math data-source="fee = collateral * rate"></math>'
await assertFormulaMetadataUnchanged(formulaMetadataFixture, '<p>Fees accrue to eligible capacity owners.</p><math data-source="fee = collateral * rate"></math>')
await assert.rejects(assertFormulaMetadataUnchanged(formulaMetadataFixture, '<p>Vault owners earn fees.</p><math data-source="fee = collateral / rate"></math>'), /Machine-readable formula metadata changed/)

const renderedMarkdownParagraphBodies = (text: string) => parsedHtmlParagraphBodies(Bun.markdown.html(text), 'script, style, template, noscript, pre, table, li')


const normalizeDuplicateSyntax = (text: string) =>
	normalizeWhitespace(text)
		.toLowerCase()
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/\\(?:cdot|times)\b/g, '*')
		.replace(/\\(?:neq|ne)\b/g, '!=')
		.replace(/\\(?:lor|vee)\b|\|\|/g, ' or ')
		.replace(/\\(?:land|wedge)\b|&&/g, ' and ')
		.replace(/[×·⋅]/g, '*')
		.replace(/÷/g, '/')
		.replace(/[−–—]/g, '-')
		.replace(/≤/g, '<=')
		.replace(/≥/g, '>=')

const normalizeDuplicateCandidate = (text: string) =>
	normalizeDuplicateSyntax(text)
		.replace(/[^a-z0-9_=+\-*/<>^?:.%&|!]+/g, ' ')
		.replace(/\s*([_=+\-*/<>^?:%&|!])\s*/g, ' $1 ')
		.replace(/\s+/g, ' ')
		.trim()

const htmlDocumentationTextFixture = htmlToDocumentationText('<main><div>Container warning</div><dl><dt>Term</dt><dd>Definition warning</dd></dl><details><summary>Disclosure warning</summary><p>Expanded warning</p></details><figure><figcaption>Figure warning</figcaption></figure><script>Hidden warning</script></main>')
assert.match(htmlDocumentationTextFixture, /Container warning[\s\S]*Definition warning[\s\S]*Disclosure warning[\s\S]*Expanded warning[\s\S]*Figure warning/, 'HTML documentation text extraction must retain visible prose from semantic containers')
assert.doesNotMatch(htmlDocumentationTextFixture, /Hidden warning/, 'HTML documentation text extraction must ignore script content')

const normalizeDuplicateFormula = (text: string) =>
	normalizeDuplicateSyntax(text)
		.replace(/[^a-z0-9_=+\-*/<>^?:.%()[\],&|!]+/g, ' ')
		.replace(/\s*([_=+\-*/<>^?:%()[\],&|!])\s*/g, ' $1 ')
		.replace(/\s+/g, ' ')
		.trim()

assert.equal(normalizeDuplicateFormula('result = a + b + c + d + e'), normalizeDuplicateFormula(' RESULT=a+b+c+d+e '), 'formula duplicate normalization should ignore formatting differences')
assert.notEqual(normalizeDuplicateFormula('result = a + b + c + d + e'), normalizeDuplicateFormula('result = a - b - c - d - e'), 'formula duplicate normalization should preserve operator differences')
assert.notEqual(normalizeDuplicateFormula('a != b'), normalizeDuplicateFormula('a = b'), 'formula duplicate normalization should preserve inequality')
assert.equal(normalizeDuplicateFormula('result = a \\cdot b \\times c'), normalizeDuplicateFormula('result = a * b * c'), 'formula duplicate normalization should unify multiplication notation')
assert.equal(normalizeDuplicateFormula('result = a || b && c'), normalizeDuplicateFormula('result = a or b and c'), 'formula duplicate normalization should preserve and normalize logical operators')
assert.notEqual(normalizeDuplicateCandidate('the guard requires a > b'), normalizeDuplicateCandidate('the guard requires a < b'), 'paragraph duplicate normalization should preserve comparison direction')
assert.notEqual(normalizeDuplicateCandidate('the guard requires a != b'), normalizeDuplicateCandidate('the guard requires a = b'), 'paragraph duplicate normalization should preserve inequality')

type DuplicateBlockMap = Map<string, string[]>

const recordDuplicateCandidate = (blocks: DuplicateBlockMap, path: string, label: string, text: string, minimumWords: number, normalize = normalizeDuplicateCandidate) => {
	const normalized = normalize(text)
	if (normalized.split(' ').length < minimumWords) {
		return
	}
	const locations = blocks.get(normalized) ?? []
	locations.push(`${path}:${label}`)
	blocks.set(normalized, locations)
}

const duplicateParagraphBodies = async (path: string, text: string) => {
	if (path.endsWith('.html')) {
		return parsedHtmlParagraphBodies(text)
	}
	if (path.endsWith('.md')) {
		return renderedMarkdownParagraphBodies(text)
	}
	return []
}

const recordDuplicateParagraphs = async (blocks: DuplicateBlockMap, path: string, text: string) => (await duplicateParagraphBodies(path, text)).forEach((paragraph, index) => recordDuplicateCandidate(blocks, path, `paragraph ${index + 1}`, paragraph, 18))

const duplicateDetectorFixtureBlocks: DuplicateBlockMap = new Map()
const duplicateDetectorFixture = 'Canonical duplication fixtures preserve meaningful operators while ignoring ordinary sentence punctuation across the rendered documentation sources reviewed by this content check.'
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'docs/example.html', `<script>const embedded = ${JSON.stringify(`<p>${duplicateDetectorFixture}</p>`)}</script><template><p>${duplicateDetectorFixture}</p></template><p>${duplicateDetectorFixture}<script>${duplicateDetectorFixture}</script></p>`)
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'README-example.md', `${duplicateDetectorFixture}\n\n\`\`\`html\n<p>${duplicateDetectorFixture}</p>\n\`\`\`\n\n| Example |\n| --- |\n| ${duplicateDetectorFixture} |\n\n- ${duplicateDetectorFixture}`)
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'docs/example.js', `export const example = '${duplicateDetectorFixture}'`)
assert.deepEqual(Array.from(duplicateDetectorFixtureBlocks.values()), [['docs/example.html:paragraph 1', 'README-example.md:paragraph 1']], 'duplicate paragraph detection should compare rendered HTML and repository-level Markdown prose but ignore JavaScript source')

const inlineCodeFixtureBlocks: DuplicateBlockMap = new Map()
const inlineCodeFixturePrefix = 'Rendered duplication candidates retain the inline identifier'
const inlineCodeFixtureSuffix = 'while comparing otherwise identical technical paragraphs across HTML and Markdown documentation sources.'
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'docs/inline-example.html', `<p>${inlineCodeFixturePrefix} <code>alphaLimit</code> ${inlineCodeFixtureSuffix}</p>`)
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'README-inline-example.md', `${inlineCodeFixturePrefix} \`alphaLimit\` ${inlineCodeFixtureSuffix}`)
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'README-distinct-inline-example.md', `${inlineCodeFixturePrefix} \`betaLimit\` ${inlineCodeFixtureSuffix}`)
assert.deepEqual(
	Array.from(inlineCodeFixtureBlocks.values()),
	[['docs/inline-example.html:paragraph 1', 'README-inline-example.md:paragraph 1'], ['README-distinct-inline-example.md:paragraph 1']],
	'duplicate paragraph detection should align HTML and repository-level Markdown inline code while preserving identifier differences',
)

const duplicateDetectorFormulaFixture = 'result = a + b + c + d + e'
assert.deepEqual(
	await parsedHtmlFormulaSources(`<script>const embedded = ${JSON.stringify(`<math data-source="${duplicateDetectorFormulaFixture}"></math>`)}</script><template><math data-source="${duplicateDetectorFormulaFixture}"></math></template><math data-source="${duplicateDetectorFormulaFixture}"></math>`),
	[duplicateDetectorFormulaFixture],
	'formula duplicate detection should inspect rendered MathML but ignore script and template sources',
)

const duplicateBlocks: DuplicateBlockMap = new Map()
const generatedDocumentationFiles = new Set(['docs/assets/js/chartRuntime.js', 'docs/assets/js/docsData.js', 'docs/assets/js/docsSearchData.js', 'docs/reference/contracts.html'])

const docsGlob = new Bun.Glob('docs/**/*.{html,js}')
const paths = ['README.md']
for await (const path of docsGlob.scan('.')) {
	paths.push(path)
}

for (const path of paths.sort()) {
	if (generatedDocumentationFiles.has(path)) {
		continue
	}
	const text = await Bun.file(path).text()
	await recordDuplicateParagraphs(duplicateBlocks, path, text)
	if (path.endsWith('.html')) {
		;(await parsedHtmlFormulaSources(text)).forEach((formula, index) => recordDuplicateCandidate(duplicateBlocks, path, `formula ${index + 1}`, formula, 6, normalizeDuplicateFormula))
	}
}
const duplicateViolations = Array.from(duplicateBlocks.values())
	.filter(locations => new Set(locations.map(location => location.split(':')[0])).size > 1)
	.map(locations => locations.join(', '))
assert.deepEqual(duplicateViolations, [], 'Documentation repeats the same paragraph or formula across files; keep one canonical owner and link to it')

const functionStyleRoundingPattern = /(?<!Math\.)\b(?:floor|ceil)\(/
assert.match('floor(displayedValue)', functionStyleRoundingPattern, 'displayed function-style rounding fixture should be rejected')
assert.doesNotMatch('Math.floor(executableValue)', functionStyleRoundingPattern, 'executable Math.floor calls should remain allowed')
const visibleFormulaSourcePaths = [...new Bun.Glob('docs/**/*.html').scanSync('.'), 'docs/charts/chartMetadata.ts', 'docs/charts/diagramModels.ts', 'docs/charts/chartRuntime.ts']
for (const path of visibleFormulaSourcePaths) {
	const source = await Bun.file(path).text()
	const visibleSource = path.endsWith('.html') ? source.replaceAll(/<script\b[\s\S]*?<\/script>/gi, '') : source
	assert.doesNotMatch(visibleSource, functionStyleRoundingPattern, `${path} uses function-style rounding notation in displayed documentation`)
}
