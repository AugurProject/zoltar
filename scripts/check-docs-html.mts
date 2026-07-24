import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Document, Element, Window } from 'happy-dom'

type ParsedHtmlDocument = {
	document: Document
	filePath: string
	ids: Set<string>
	relativePath: string
	text: string
	window: Window
}

type ValidationFailure = {
	message: string
	relativePath: string
}

const repositoryRootPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDirectoryPath = path.join(repositoryRootPath, 'docs')
const conflictMarkerPattern = /^(<<<<<<<|=======|>>>>>>>)($| )/m
const markdownLinkPattern = /\[[^\]]+\]\(([^)\s]+)(?:\s+['"][^)]*['"])?\)/g

export async function assertDocsHtmlValid(): Promise<void> {
	const failures = await validateDocsHtml()
	if (failures.length === 0) {
		return
	}

	const formattedFailures = failures.map(failure => `- ${failure.relativePath}: ${failure.message}`).join('\n')
	throw new Error(`Docs HTML validation failed:\n${formattedFailures}`)
}

export async function validateDocsHtml(): Promise<ValidationFailure[]> {
	const failures: ValidationFailure[] = []
	const htmlFilePaths = await findDocsFiles('.html')
	const markdownFilePaths = await findDocsFiles('.md')
	const parsedDocuments = await Promise.all(htmlFilePaths.map(parseHtmlDocument))
	const parsedDocumentsByPath = new Map(parsedDocuments.map(document => [document.filePath, document]))
	const markdownAnchorsByPath = await collectMarkdownAnchorsByPath(markdownFilePaths)

	for (const parsedDocument of parsedDocuments) {
		validateTextEnvelope(parsedDocument, failures)
		validateIds(parsedDocument, failures)
		validateAriaReferences(parsedDocument, failures)
		if (isLegacyRedirectDocument(parsedDocument)) {
			validateLegacyRedirect(parsedDocument, failures)
		} else {
			if (parsedDocument.document.querySelector('meta[http-equiv="refresh"]') !== null) {
				addFailure(parsedDocument, 'only docs/start-here.html may use a meta refresh redirect', failures)
			}
			validateDiagrams(parsedDocument, failures)
		}
		validateEquations(parsedDocument, failures)
		validateTables(parsedDocument, failures)
		await validateHtmlLinks(parsedDocument, parsedDocumentsByPath, markdownAnchorsByPath, failures)
	}

	for (const markdownFilePath of markdownFilePaths) {
		await validateMarkdownLinks(markdownFilePath, parsedDocumentsByPath, markdownAnchorsByPath, failures)
	}

	for (const parsedDocument of parsedDocuments) {
		parsedDocument.window.close()
	}

	return failures
}

function isLegacyRedirectDocument(parsedDocument: ParsedHtmlDocument): boolean {
	return parsedDocument.relativePath === 'docs/start-here.html'
}

function validateLegacyRedirect(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const expectedTarget = './documentation.html'
	const refresh = parsedDocument.document.querySelector('meta[http-equiv="refresh"]')
	const refreshContent = refresh?.getAttribute('content')?.trim() ?? ''
	if (!/^0\s*;\s*url=\.\/documentation\.html$/i.test(refreshContent)) {
		addFailure(parsedDocument, `legacy redirect meta refresh must target ${expectedTarget} with zero delay`, failures)
	}

	const canonicalTarget = parsedDocument.document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim()
	if (canonicalTarget !== expectedTarget) {
		addFailure(parsedDocument, `legacy redirect canonical link must target ${expectedTarget}`, failures)
	}

	const fallbackTarget = parsedDocument.document.querySelector('a')?.getAttribute('href')?.trim()
	if (fallbackTarget !== expectedTarget) {
		addFailure(parsedDocument, `legacy redirect fallback link must target ${expectedTarget}`, failures)
	}
}

async function findDocsFiles(extension: string): Promise<string[]> {
	const entries = await readdir(docsDirectoryPath)
	return entries
		.filter(entry => entry.endsWith(extension))
		.map(entry => path.join(docsDirectoryPath, entry))
		.sort()
}

async function parseHtmlDocument(filePath: string): Promise<ParsedHtmlDocument> {
	const text = await readFile(filePath, 'utf8')
	const window = new Window({
		url: pathToFileURL(filePath).href,
	})
	window.document.write(text)
	window.document.close()

	return {
		document: window.document,
		filePath,
		ids: collectIds(window.document),
		relativePath: relativeToRepository(filePath),
		text,
		window,
	}
}

function validateTextEnvelope(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	if (conflictMarkerPattern.test(parsedDocument.text)) {
		addFailure(parsedDocument, 'contains unresolved conflict markers', failures)
	}

	const doctypeName = parsedDocument.document.doctype?.name
	if (doctypeName !== 'html') {
		addFailure(parsedDocument, 'is missing an HTML doctype', failures)
	}

	const title = parsedDocument.document.querySelector('head > title')?.textContent?.trim()
	if (title === undefined || title.length === 0) {
		addFailure(parsedDocument, 'is missing a non-empty <title>', failures)
	}
}

function validateIds(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const seen = new Set<string>()
	for (const element of Array.from(parsedDocument.document.querySelectorAll('[id]'))) {
		const id = element.getAttribute('id')?.trim()
		if (id === undefined || id.length === 0) {
			addFailure(parsedDocument, `${describeElement(element)} has an empty id`, failures)
			continue
		}
		if (seen.has(id)) {
			addFailure(parsedDocument, `duplicate id "${id}" on ${describeElement(element)}`, failures)
			continue
		}
		seen.add(id)
	}
}

function validateAriaReferences(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	for (const element of Array.from(parsedDocument.document.querySelectorAll('[aria-labelledby]'))) {
		const referencedIds = splitIdList(element.getAttribute('aria-labelledby'))
		if (referencedIds.length === 0) {
			addFailure(parsedDocument, `${describeElement(element)} has an empty aria-labelledby`, failures)
			continue
		}
		for (const referencedId of referencedIds) {
			if (!parsedDocument.ids.has(referencedId)) {
				addFailure(parsedDocument, `${describeElement(element)} references missing aria-labelledby id "${referencedId}"`, failures)
			}
		}
	}
}

function validateDiagrams(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const figures = Array.from(parsedDocument.document.querySelectorAll('figure.diagram'))
	if (figures.length === 0) {
		addFailure(parsedDocument, 'does not contain any figure.diagram elements', failures)
		return
	}

	for (const figure of figures) {
		validateFigureEnvelope(parsedDocument, figure, failures)

		const svg = figure.querySelector('svg')
		if (svg === null) {
			addFailure(parsedDocument, `${describeElement(figure)} is missing an svg`, failures)
			continue
		}

		const role = svg.getAttribute('role')?.trim()
		if (role !== 'img') {
			addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} must use role="img"`, failures)
		}

		const ariaLabel = svg.getAttribute('aria-label')?.trim()
		const labelledBy = splitIdList(svg.getAttribute('aria-labelledby'))
		const title = svg.querySelector('title')?.textContent?.trim()
		const desc = svg.querySelector('desc')?.textContent?.trim()
		const hasInlineLabel = ariaLabel !== undefined && ariaLabel.length > 0
		const hasTitleAndDesc = title !== undefined && title.length > 0 && desc !== undefined && desc.length > 0
		if (!hasInlineLabel && labelledBy.length === 0) {
			addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} needs aria-label or aria-labelledby`, failures)
		}
		if (!hasInlineLabel && !hasTitleAndDesc) {
			addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} needs non-empty title and desc elements`, failures)
		}

		validateViewBox(parsedDocument, svg, figure, failures)

		const shapeCount = svg.querySelectorAll('circle, ellipse, line, path, polygon, polyline, rect, text').length
		if (shapeCount === 0) {
			addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} has no visible SVG primitives`, failures)
		}
	}
}

function validateFigureEnvelope(parsedDocument: ParsedHtmlDocument, figure: Element, failures: ValidationFailure[]): void {
	const figureId = figure.getAttribute('id')?.trim()
	if (figureId === undefined || figureId.length === 0) {
		addFailure(parsedDocument, `${describeElement(figure)} is missing a stable id for figure references`, failures)
	} else if (!figureId.startsWith('fig-')) {
		addFailure(parsedDocument, `${describeElement(figure)} id "${figureId}" must start with "fig-"`, failures)
	}

	const captions = Array.from(figure.children).filter(child => child.classList.contains('diagram-caption'))
	if (captions.length !== 1) {
		addFailure(parsedDocument, `${describeElement(figure)} must have exactly one direct .diagram-caption`, failures)
		return
	}

	const caption = captions[0]
	if (caption === undefined) {
		addFailure(parsedDocument, `${describeElement(figure)} is missing a .diagram-caption`, failures)
		return
	}

	const figureLabels = Array.from(caption.querySelectorAll('.figure-label'))
	if (figureLabels.length !== 1) {
		addFailure(parsedDocument, `${describeElement(figure)} caption must contain exactly one .figure-label`, failures)
		return
	}

	const figureLabel = figureLabels[0]
	const labelText = figureLabel?.textContent?.trim()
	if (labelText === undefined || labelText.length === 0) {
		addFailure(parsedDocument, `${describeElement(figure)} has an empty figure label`, failures)
		return
	}

	if (/^figure\s+\d+/i.test(labelText)) {
		addFailure(parsedDocument, `${describeElement(figure)} hard-codes its figure number in the label`, failures)
	}

	const captionText = caption.textContent?.trim() ?? ''
	if (captionText.length <= labelText.length) {
		addFailure(parsedDocument, `${describeElement(figure)} caption needs explanatory text after the label`, failures)
	}
}

function validateViewBox(parsedDocument: ParsedHtmlDocument, svg: Element, figure: Element, failures: ValidationFailure[]): void {
	const viewBox = svg.getAttribute('viewBox')?.trim()
	if (viewBox === undefined || viewBox.length === 0) {
		addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} is missing a viewBox`, failures)
		return
	}

	const values = viewBox.split(/\s+/).map(Number)
	if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
		addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} has malformed viewBox "${viewBox}"`, failures)
		return
	}

	const width = values[2]
	const height = values[3]
	if (width === undefined || height === undefined || width <= 0 || height <= 0) {
		addFailure(parsedDocument, `${describeElement(svg)} in ${describeElement(figure)} must have positive viewBox width and height`, failures)
	}
}

function validateEquations(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	for (const formula of Array.from(parsedDocument.document.querySelectorAll('.formula'))) {
		addFailure(parsedDocument, `${describeElement(formula)} must use native MathML inside .equation instead of stale .formula markup`, failures)
	}

	const equations = Array.from(parsedDocument.document.querySelectorAll('.equation'))
	for (const equation of equations) {
		validateEquationEnvelope(parsedDocument, equation, failures)
	}
}

function validateEquationEnvelope(parsedDocument: ParsedHtmlDocument, equation: Element, failures: ValidationFailure[]): void {
	const equationId = equation.getAttribute('id')?.trim()
	if (equationId === undefined || equationId.length === 0) {
		addFailure(parsedDocument, `${describeElement(equation)} is missing a stable id for equation references`, failures)
	} else if (!equationId.startsWith('eq-')) {
		addFailure(parsedDocument, `${describeElement(equation)} id "${equationId}" must start with "eq-"`, failures)
	}

	const mathBlocks = Array.from(equation.children).filter(child => child.tagName.toLowerCase() === 'math')
	if (mathBlocks.length !== 1) {
		addFailure(parsedDocument, `${describeElement(equation)} must have exactly one direct MathML <math> child`, failures)
	} else {
		const mathBlock = mathBlocks[0]
		if (mathBlock !== undefined) {
			validateMathBlock(parsedDocument, mathBlock, equation, failures)
		}
	}

	const captions = Array.from(equation.children).filter(child => child.classList.contains('equation-caption'))
	if (captions.length !== 1) {
		addFailure(parsedDocument, `${describeElement(equation)} must have exactly one direct .equation-caption`, failures)
		return
	}

	const caption = captions[0]
	if (caption === undefined) {
		addFailure(parsedDocument, `${describeElement(equation)} is missing an .equation-caption`, failures)
		return
	}

	const equationLabels = Array.from(caption.querySelectorAll('.equation-label'))
	if (equationLabels.length !== 1) {
		addFailure(parsedDocument, `${describeElement(equation)} caption must contain exactly one .equation-label`, failures)
		return
	}

	const equationLabel = equationLabels[0]
	const labelText = equationLabel?.textContent?.trim()
	if (labelText === undefined || labelText.length === 0) {
		addFailure(parsedDocument, `${describeElement(equation)} has an empty equation label`, failures)
		return
	}

	if (/^equation\s+\d+/i.test(labelText)) {
		addFailure(parsedDocument, `${describeElement(equation)} hard-codes its equation number in the label`, failures)
	}

	const captionText = caption.textContent?.trim() ?? ''
	if (captionText.length <= labelText.length) {
		addFailure(parsedDocument, `${describeElement(equation)} caption needs explanatory text after the label`, failures)
	}
}

function validateMathBlock(parsedDocument: ParsedHtmlDocument, mathBlock: Element, equation: Element, failures: ValidationFailure[]): void {
	const display = mathBlock.getAttribute('display')?.trim()
	if (display !== 'block') {
		addFailure(parsedDocument, `${describeElement(mathBlock)} in ${describeElement(equation)} must use display="block"`, failures)
	}

	const ariaLabel = mathBlock.getAttribute('aria-label')?.trim()
	if (ariaLabel === undefined || ariaLabel.length === 0) {
		addFailure(parsedDocument, `${describeElement(mathBlock)} in ${describeElement(equation)} needs a non-empty aria-label`, failures)
	}

	const source = mathBlock.getAttribute('data-source')?.trim()
	if (source === undefined || source.length === 0) {
		addFailure(parsedDocument, `${describeElement(mathBlock)} in ${describeElement(equation)} needs a plain-text data-source`, failures)
	}

	const mathExpressionNodes = mathBlock.querySelectorAll('mfrac, mi, mn, mo, mrow, msup, mtext')
	if (mathExpressionNodes.length === 0) {
		addFailure(parsedDocument, `${describeElement(mathBlock)} in ${describeElement(equation)} has no MathML expression nodes`, failures)
	}
}

function validateTables(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	for (const table of Array.from(parsedDocument.document.querySelectorAll('table'))) {
		const headerRows = Array.from(table.querySelectorAll('thead tr'))
		const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
		if (headerRows.length === 0) {
			addFailure(parsedDocument, `${describeElement(table)} is missing a thead row`, failures)
			continue
		}
		if (bodyRows.length === 0) {
			addFailure(parsedDocument, `${describeElement(table)} is missing tbody rows`, failures)
			continue
		}

		const expectedColumnCount = countColumns(headerRows[0])
		if (expectedColumnCount === 0) {
			addFailure(parsedDocument, `${describeElement(table)} has an empty header row`, failures)
			continue
		}

		for (const row of [...headerRows, ...bodyRows]) {
			const columnCount = countColumns(row)
			if (columnCount !== expectedColumnCount) {
				addFailure(parsedDocument, `${describeElement(row)} in ${describeElement(table)} has ${columnCount} columns, expected ${expectedColumnCount}`, failures)
			}
		}
	}
}

async function validateHtmlLinks(parsedDocument: ParsedHtmlDocument, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, markdownAnchorsByPath: Map<string, Set<string>>, failures: ValidationFailure[]): Promise<void> {
	for (const link of Array.from(parsedDocument.document.querySelectorAll('a[href]'))) {
		const href = link.getAttribute('href')?.trim()
		if (href === undefined || href.length === 0) {
			addFailure(parsedDocument, `${describeElement(link)} has an empty href`, failures)
			continue
		}
		await validateLocalLink(parsedDocument.filePath, href, parsedDocumentsByPath, markdownAnchorsByPath, parsedDocument.relativePath, failures)
	}
}

async function validateMarkdownLinks(markdownFilePath: string, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, markdownAnchorsByPath: Map<string, Set<string>>, failures: ValidationFailure[]): Promise<void> {
	const text = await readFile(markdownFilePath, 'utf8')
	const relativePath = relativeToRepository(markdownFilePath)
	if (conflictMarkerPattern.test(text)) {
		failures.push({
			message: 'contains unresolved conflict markers',
			relativePath,
		})
	}

	for (const match of text.matchAll(markdownLinkPattern)) {
		const href = match[1]
		if (href === undefined) {
			continue
		}
		await validateLocalLink(markdownFilePath, href, parsedDocumentsByPath, markdownAnchorsByPath, relativePath, failures)
	}
}

async function validateLocalLink(sourceFilePath: string, href: string, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, markdownAnchorsByPath: Map<string, Set<string>>, sourceRelativePath: string, failures: ValidationFailure[]): Promise<void> {
	if (isExternalLink(href)) {
		return
	}

	if (href.startsWith('javascript:')) {
		failures.push({
			message: `uses disallowed javascript href "${href}"`,
			relativePath: sourceRelativePath,
		})
		return
	}

	const [targetPathPart, rawFragment] = splitHref(href)
	const targetFilePath = targetPathPart.length === 0 ? sourceFilePath : path.resolve(path.dirname(sourceFilePath), decodeURIComponent(targetPathPart))
	try {
		await access(targetFilePath)
	} catch (error) {
		failures.push({
			message: `links to missing local file "${href}": ${formatUnknownError(error)}`,
			relativePath: sourceRelativePath,
		})
		return
	}

	if (rawFragment === undefined || rawFragment.length === 0) {
		return
	}

	const fragment = decodeURIComponent(rawFragment)
	const parsedTargetDocument = parsedDocumentsByPath.get(targetFilePath)
	if (parsedTargetDocument !== undefined) {
		if (!parsedTargetDocument.ids.has(fragment)) {
			failures.push({
				message: `links to missing HTML fragment "${href}"`,
				relativePath: sourceRelativePath,
			})
		}
		return
	}

	const markdownAnchors = markdownAnchorsByPath.get(targetFilePath)
	if (markdownAnchors !== undefined && !markdownAnchors.has(fragment)) {
		failures.push({
			message: `links to missing Markdown fragment "${href}"`,
			relativePath: sourceRelativePath,
		})
	}
}

async function collectMarkdownAnchorsByPath(markdownFilePaths: string[]): Promise<Map<string, Set<string>>> {
	const anchorsByPath = new Map<string, Set<string>>()
	for (const filePath of markdownFilePaths) {
		const text = await readFile(filePath, 'utf8')
		anchorsByPath.set(filePath, collectMarkdownAnchors(text))
	}
	return anchorsByPath
}

function collectMarkdownAnchors(text: string): Set<string> {
	const anchors = new Set<string>()
	const slugCounts = new Map<string, number>()
	for (const line of text.split('\n')) {
		const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
		if (heading === null) {
			continue
		}
		const headingText = heading[2]
		if (headingText === undefined) {
			continue
		}
		const baseSlug = markdownHeadingToSlug(headingText)
		const priorCount = slugCounts.get(baseSlug) ?? 0
		slugCounts.set(baseSlug, priorCount + 1)
		anchors.add(priorCount === 0 ? baseSlug : `${baseSlug}-${priorCount}`)
	}
	return anchors
}

function markdownHeadingToSlug(headingText: string): string {
	return headingText
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9 -]/g, '')
		.replace(/\s+/g, '-')
}

function splitHref(href: string): [string, string | undefined] {
	const hashIndex = href.indexOf('#')
	if (hashIndex === -1) {
		return [href, undefined]
	}
	return [href.slice(0, hashIndex), href.slice(hashIndex + 1)]
}

function isExternalLink(href: string): boolean {
	return /^(https?:|mailto:|tel:)/.test(href)
}

function splitIdList(value: string | null): string[] {
	if (value === null) {
		return []
	}
	return value
		.trim()
		.split(/\s+/)
		.filter(item => item.length > 0)
}

function collectIds(document: Document): Set<string> {
	const ids = new Set<string>()
	for (const element of Array.from(document.querySelectorAll('[id]'))) {
		const id = element.getAttribute('id')?.trim()
		if (id !== undefined && id.length > 0) {
			ids.add(id)
		}
	}
	return ids
}

function countColumns(row: Element | undefined): number {
	if (row === undefined) {
		return 0
	}
	return Array.from(row.children).reduce((total, cell) => {
		const tagName = cell.tagName.toLowerCase()
		if (tagName !== 'td' && tagName !== 'th') {
			return total
		}
		const colspan = cell.getAttribute('colspan')
		if (colspan === null) {
			return total + 1
		}
		const parsedColspan = Number(colspan)
		if (!Number.isInteger(parsedColspan) || parsedColspan < 1) {
			return total
		}
		return total + parsedColspan
	}, 0)
}

function addFailure(parsedDocument: ParsedHtmlDocument, message: string, failures: ValidationFailure[]): void {
	failures.push({
		message,
		relativePath: parsedDocument.relativePath,
	})
}

function describeElement(element: Element): string {
	const id = element.getAttribute('id')?.trim()
	const className = element.getAttribute('class')?.trim()
	const idSuffix = id === undefined || id.length === 0 ? '' : `#${id}`
	const classSuffix = className === undefined || className.length === 0 ? '' : `.${className.split(/\s+/).join('.')}`
	return `<${element.tagName.toLowerCase()}${idSuffix}${classSuffix}>`
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	return String(error)
}

function relativeToRepository(filePath: string): string {
	return path.relative(repositoryRootPath, filePath)
}

if (import.meta.main) {
	await assertDocsHtmlValid()
}
