import { access, readFile } from 'node:fs/promises'
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
	const parsedDocuments = await Promise.all(htmlFilePaths.map(parseHtmlDocument))
	const parsedDocumentsByPath = new Map(parsedDocuments.map(document => [document.filePath, document]))

	for (const parsedDocument of parsedDocuments) {
		validateTextEnvelope(parsedDocument, failures)
		validateResponsiveRuntime(parsedDocument, failures)
		validateIds(parsedDocument, failures)
		validateInteractiveCatalogs(parsedDocument, failures)
		validateAriaReferences(parsedDocument, failures)
		validatePlotMounts(parsedDocument, failures)
		const hasMetaRefresh = Array.from(parsedDocument.document.querySelectorAll('meta[http-equiv]')).some(meta => meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh')
		if (hasMetaRefresh) {
			addFailure(parsedDocument, 'meta refresh redirects are not allowed in the documentation corpus', failures)
		}
		validateDiagrams(parsedDocument, failures)
		validateEquations(parsedDocument, failures)
		validateTables(parsedDocument, failures)
		await validateHtmlLinks(parsedDocument, parsedDocumentsByPath, failures)
	}

	for (const parsedDocument of parsedDocuments) {
		parsedDocument.window.close()
	}

	return failures
}

function validateResponsiveRuntime(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	if (parsedDocument.relativePath === 'docs/documentation.html') return
	const runtimeScripts = elementsReferencingAsset(parsedDocument, 'script[src]', 'src', 'assets/js/responsiveDocs.js')
	if (runtimeScripts.length !== 1) {
		addFailure(parsedDocument, 'must load docs/assets/js/responsiveDocs.js exactly once for responsive equations and overflow cues', failures)
	}
}

async function findDocsFiles(extension: string): Promise<string[]> {
	const paths: string[] = []
	const glob = new Bun.Glob(`**/*${extension}`)
	for await (const relativePath of glob.scan({ cwd: docsDirectoryPath, onlyFiles: true })) {
		paths.push(path.join(docsDirectoryPath, relativePath))
	}
	return paths.sort()
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

function validateInteractiveCatalogs(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const interactiveDetails = Array.from(parsedDocument.document.querySelectorAll('details.interactive-example'))
	for (const details of interactiveDetails) {
		const id = details.getAttribute('id')?.trim() ?? ''
		if (id.length === 0) {
			addFailure(parsedDocument, `${describeElement(details)} needs a stable id for direct links and shared scenarios`, failures)
		}
	}
	if (interactiveDetails.length > 0 && elementsReferencingAsset(parsedDocument, 'script[src]', 'src', 'assets/js/interactiveTools.js').length === 0) {
		addFailure(parsedDocument, 'interactive calculators must load interactiveTools.js for presets, reset, sharing, and live results', failures)
	}

	const invariantEntries = Array.from(parsedDocument.document.querySelectorAll('details.invariant-entry'))
	for (const entry of invariantEntries) {
		const identifier = entry.querySelector('summary code')?.textContent?.trim().toLowerCase() ?? ''
		const id = entry.getAttribute('id')?.trim() ?? ''
		if (identifier.length === 0 || id !== identifier) {
			addFailure(parsedDocument, `${describeElement(entry)} id must match its invariant identifier "${identifier || 'missing'}"`, failures)
		}
	}
	if (invariantEntries.length > 0) {
		if (elementsReferencingAsset(parsedDocument, 'script[src]', 'src', 'assets/js/invariantExplorer.js').length === 0) {
			addFailure(parsedDocument, 'invariant catalog must load invariantExplorer.js', failures)
		}
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
		return
	}

	for (const figure of figures) {
		validateFigureEnvelope(parsedDocument, figure, failures)

		const chartMount = figure.querySelector('[data-plot-chart]')
		if (chartMount === null) {
			addFailure(parsedDocument, `${describeElement(figure)} is missing an Observable Plot mount`, failures)
			continue
		}

		const figureId = figure.getAttribute('id')?.trim()
		const chartId = chartMount.getAttribute('data-plot-chart')?.trim()
		if (chartId !== figureId) {
			addFailure(parsedDocument, `${describeElement(chartMount)} must use its figure id as data-plot-chart`, failures)
		}
	}
}

function validatePlotMounts(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const inlineSvgCount = parsedDocument.document.querySelectorAll('svg').length
	if (inlineSvgCount > 0) {
		addFailure(parsedDocument, `contains ${inlineSvgCount} hand-authored inline SVG element(s); documentation visuals must use Observable Plot mounts`, failures)
	}

	const chartMounts = Array.from(parsedDocument.document.querySelectorAll('[data-plot-chart]'))
	if (chartMounts.length === 0) {
		return
	}
	const runtimeScripts = elementsReferencingAsset(parsedDocument, 'script[src]', 'src', 'assets/js/chartRuntime.js')
	if (runtimeScripts.length !== 1) {
		addFailure(parsedDocument, `must load docs/assets/js/chartRuntime.js exactly once when Plot mounts are present`, failures)
	}

	for (const chartMount of chartMounts) {
		const chartId = chartMount.getAttribute('data-plot-chart')?.trim()
		if (chartId === undefined || chartId.length === 0) {
			addFailure(parsedDocument, `${describeElement(chartMount)} is missing a stable data-plot-chart id`, failures)
		}

		const role = chartMount.getAttribute('role')?.trim()
		if (role !== 'img') {
			addFailure(parsedDocument, `${describeElement(chartMount)} must use role="img" before Plot loads`, failures)
		}

		const ariaLabel = chartMount.getAttribute('aria-label')?.trim()
		if (ariaLabel === undefined || ariaLabel.length === 0) {
			addFailure(parsedDocument, `${describeElement(chartMount)} needs a non-empty aria-label`, failures)
		}

		const width = Number(chartMount.getAttribute('data-plot-width'))
		const height = Number(chartMount.getAttribute('data-plot-height'))
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			addFailure(parsedDocument, `${describeElement(chartMount)} needs positive Plot width and height metadata`, failures)
		}

		const fallback = chartMount.querySelector('.plot-chart-fallback')?.textContent?.trim()
		if (fallback === undefined || fallback.length === 0) {
			addFailure(parsedDocument, `${describeElement(chartMount)} needs explanatory fallback text`, failures)
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

async function validateHtmlLinks(parsedDocument: ParsedHtmlDocument, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, failures: ValidationFailure[]): Promise<void> {
	for (const link of Array.from(parsedDocument.document.querySelectorAll('a[href]'))) {
		const rawHref = link.getAttribute('href')
		const href = rawHref?.trim()
		if (href === undefined || href.length === 0) {
			addFailure(parsedDocument, `${describeElement(link)} has an empty href`, failures)
			continue
		}
		if (rawHref !== href) {
			addFailure(parsedDocument, `${describeElement(link)} href has leading or trailing whitespace`, failures)
		}
		await validateLocalLink(parsedDocument.filePath, href, parsedDocumentsByPath, parsedDocument.relativePath, failures)
	}
}

async function validateLocalLink(sourceFilePath: string, href: string, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, sourceRelativePath: string, failures: ValidationFailure[]): Promise<void> {
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

export function resolveDocumentReference(filePath: string, reference: string): string {
	return path.resolve(path.dirname(filePath), reference)
}

function elementsReferencingAsset(parsedDocument: ParsedHtmlDocument, selector: string, attribute: string, docsRelativeAssetPath: string): Element[] {
	const expectedPath = path.join(docsDirectoryPath, docsRelativeAssetPath)
	return Array.from(parsedDocument.document.querySelectorAll(selector)).filter(element => {
		const reference = element.getAttribute(attribute)
		return reference !== null && resolveDocumentReference(parsedDocument.filePath, reference) === expectedPath
	})
}

function relativeToRepository(filePath: string): string {
	return path.relative(repositoryRootPath, filePath)
}

if (import.meta.main) {
	await assertDocsHtmlValid()
}
