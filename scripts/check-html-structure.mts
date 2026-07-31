import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Document, Element, Window } from 'happy-dom'

type ParsedHtmlDocument = {
	document: Document
	filePath: string
	ids: Set<string>
	relativePath: string
	window: Window
}

type ValidationFailure = {
	message: string
	relativePath: string
}

const repositoryRootPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const ariaIdReferenceAttributes = [
	{ allowsMultiple: false, name: 'aria-activedescendant' },
	{ allowsMultiple: true, name: 'aria-controls' },
	{ allowsMultiple: true, name: 'aria-describedby' },
	{ allowsMultiple: false, name: 'aria-details' },
	{ allowsMultiple: false, name: 'aria-errormessage' },
	{ allowsMultiple: true, name: 'aria-flowto' },
	{ allowsMultiple: true, name: 'aria-labelledby' },
	{ allowsMultiple: true, name: 'aria-owns' },
] as const

function trackedHtmlFilePaths(): string[] {
	const result = Bun.spawnSync(['git', 'ls-files', '-z', ':(glob)**/*.html'], { cwd: repositoryRootPath })
	if (result.exitCode !== 0) throw new Error(`Unable to list tracked HTML files: ${result.stderr.toString().trim()}`)
	return result.stdout
		.toString()
		.split('\0')
		.filter(Boolean)
		.map(filePath => path.join(repositoryRootPath, filePath))
		.sort()
}

async function validateHtmlStructure(): Promise<ValidationFailure[]> {
	const failures: ValidationFailure[] = []
	const htmlFilePaths = trackedHtmlFilePaths()
	const parsedDocuments = await Promise.all(htmlFilePaths.map(parseHtmlDocument))
	const parsedDocumentsByPath = new Map(parsedDocuments.map(parsedDocument => [parsedDocument.filePath, parsedDocument]))

	for (const parsedDocument of parsedDocuments) {
		validateDocumentEnvelope(parsedDocument, failures)
		validateIds(parsedDocument, failures)
		validateAriaIdReferences(parsedDocument, failures)
		await validateLocalHtmlLinks(parsedDocument, parsedDocumentsByPath, failures)
	}

	for (const parsedDocument of parsedDocuments) parsedDocument.window.close()
	return failures
}

async function parseHtmlDocument(filePath: string): Promise<ParsedHtmlDocument> {
	const window = new Window({ url: pathToFileURL(filePath).href })
	window.document.write(await readFile(filePath, 'utf8'))
	window.document.close()
	return {
		document: window.document,
		filePath,
		ids: new Set(Array.from(window.document.querySelectorAll('[id]')).map(element => element.getAttribute('id') ?? '')),
		relativePath: path.relative(repositoryRootPath, filePath),
		window,
	}
}

function validateDocumentEnvelope(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	if (parsedDocument.document.doctype?.name !== 'html') addFailure(parsedDocument, 'is missing <!doctype html>', failures)
	const language = parsedDocument.document.documentElement.getAttribute('lang')?.trim()
	if (language === undefined || language.length === 0) addFailure(parsedDocument, '<html> needs a non-empty lang attribute', failures)
	const charset = parsedDocument.document.querySelector('head > meta[charset]')?.getAttribute('charset')?.trim().toLowerCase()
	if (charset !== 'utf-8') addFailure(parsedDocument, 'needs <meta charset="utf-8"> in <head>', failures)
	const viewport = parsedDocument.document.querySelector('head > meta[name="viewport"]')?.getAttribute('content')?.trim()
	if (viewport === undefined || viewport.length === 0) addFailure(parsedDocument, 'needs a non-empty viewport meta tag in <head>', failures)
	const title = parsedDocument.document.querySelector('head > title')?.textContent?.trim()
	if (title === undefined || title.length === 0) addFailure(parsedDocument, 'needs a non-empty <title>', failures)
}

function validateIds(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	const seenIds = new Set<string>()
	for (const element of Array.from(parsedDocument.document.querySelectorAll('[id]'))) {
		const id = element.getAttribute('id')?.trim() ?? ''
		if (id.length === 0) {
			addFailure(parsedDocument, `${describeElement(element)} has an empty id`, failures)
		} else if (seenIds.has(id)) {
			addFailure(parsedDocument, `${describeElement(element)} duplicates id "${id}"`, failures)
		}
		seenIds.add(id)
	}
}

function validateAriaIdReferences(parsedDocument: ParsedHtmlDocument, failures: ValidationFailure[]): void {
	for (const message of ariaIdReferenceFailures(parsedDocument.document)) addFailure(parsedDocument, message, failures)
}

export function ariaIdReferenceFailures(document: Document): string[] {
	const failures: string[] = []
	const ids = new Set(Array.from(document.querySelectorAll('[id]')).map(element => element.getAttribute('id') ?? ''))
	for (const attribute of ariaIdReferenceAttributes) {
		for (const element of Array.from(document.querySelectorAll(`[${attribute.name}]`))) {
			const referencedIds = (element.getAttribute(attribute.name) ?? '').trim().split(/\s+/).filter(Boolean)
			if (referencedIds.length === 0) failures.push(`${describeElement(element)} has an empty ${attribute.name}`)
			if (!attribute.allowsMultiple && referencedIds.length > 1) failures.push(`${describeElement(element)} ${attribute.name} must reference exactly one id`)
			for (const referencedId of referencedIds) {
				if (!ids.has(referencedId)) failures.push(`${describeElement(element)} ${attribute.name} references missing id "${referencedId}"`)
			}
		}
	}
	return failures
}

async function validateLocalHtmlLinks(parsedDocument: ParsedHtmlDocument, parsedDocumentsByPath: Map<string, ParsedHtmlDocument>, failures: ValidationFailure[]): Promise<void> {
	for (const anchor of Array.from(parsedDocument.document.querySelectorAll('a[href]'))) {
		const href = anchor.getAttribute('href')?.trim() ?? ''
		if (href.length === 0 || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href)) continue
		const url = new URL(href, pathToFileURL(parsedDocument.filePath))
		if (url.protocol !== 'file:') continue
		const targetPath = fileURLToPath(url)
		const linksToHtml = href.startsWith('#') || path.extname(targetPath).toLowerCase() === '.html'
		if (!linksToHtml) continue
		try {
			await access(targetPath)
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
			addFailure(parsedDocument, `${describeElement(anchor)} links to missing HTML file "${href}"`, failures)
			continue
		}
		if (url.hash.length === 0) continue
		const targetDocument = parsedDocumentsByPath.get(targetPath)
		const targetId = decodeURIComponent(url.hash.slice(1))
		if (targetDocument === undefined || !targetDocument.ids.has(targetId)) {
			addFailure(parsedDocument, `${describeElement(anchor)} links to missing anchor "${href}"`, failures)
		}
	}
}

function describeElement(element: Element): string {
	const id = element.getAttribute('id')
	return `<${element.localName}${id === null ? '' : `#${id}`}>`
}

function addFailure(parsedDocument: ParsedHtmlDocument, message: string, failures: ValidationFailure[]): void {
	failures.push({ message, relativePath: parsedDocument.relativePath })
}

if (import.meta.main) {
	const failures = await validateHtmlStructure()
	if (failures.length > 0) {
		throw new Error(`HTML structure validation failed:\n${failures.map(failure => `- ${failure.relativePath}: ${failure.message}`).join('\n')}`)
	}

	console.log(`Validated structure and local references for ${trackedHtmlFilePaths().length} HTML files`)
}
