import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRootPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

type SourceSpan = { end: number; start: number }

const rawTextElementNames = new Set(['iframe', 'noembed', 'noframes', 'plaintext', 'script', 'style', 'textarea', 'title', 'xmp'])
const whitespaceSensitiveElementNames = new Set(['pre', ...rawTextElementNames])

export function paragraphSourceSpans(html: string): SourceSpan[] {
	const spans: SourceSpan[] = []
	let paragraphStart: number | undefined
	let index = 0
	while (index < html.length) {
		const tagStart = html.indexOf('<', index)
		if (tagStart < 0) break
		if (html.startsWith('<!--', tagStart)) {
			const commentEnd = html.indexOf('-->', tagStart + 4)
			index = commentEnd < 0 ? html.length : commentEnd + 3
			continue
		}
		const tagEnd = findTagEnd(html, tagStart)
		if (tagEnd < 0) break
		const tagSource = html.slice(tagStart, tagEnd + 1)
		const tagMatch = tagSource.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/i)
		if (tagMatch === null) {
			index = tagEnd + 1
			continue
		}
		const matchedTagName = tagMatch[2]
		if (matchedTagName === undefined) throw new Error(`Unable to read HTML tag at source offset ${tagStart}`)
		const closing = tagMatch[1] === '/'
		const tagName = matchedTagName.toLowerCase()
		if (!closing && tagName === 'p') paragraphStart = tagStart
		if (paragraphStart !== undefined && !closing && unsafeParagraphDescendant(tagName, tagSource)) {
			throw new Error(`<p> contains whitespace-sensitive <${tagName}> content that cannot be safely placed on one source line`)
		}
		if (closing && tagName === 'p' && paragraphStart !== undefined) {
			spans.push({ end: tagEnd + 1, start: paragraphStart })
			paragraphStart = undefined
		}
		if (!closing && rawTextElementNames.has(tagName)) {
			if (tagName === 'plaintext') {
				index = html.length
				continue
			}
			const closingPattern = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'gi')
			closingPattern.lastIndex = tagEnd + 1
			const closingMatch = closingPattern.exec(html)
			index = closingMatch === null ? html.length : closingPattern.lastIndex
		} else {
			index = tagEnd + 1
		}
	}
	return spans
}

function findTagEnd(html: string, tagStart: number): number {
	let quote: '"' | "'" | undefined
	for (let index = tagStart + 1; index < html.length; index += 1) {
		const character = html[index]
		if (quote === undefined && (character === '"' || character === "'")) quote = character
		else if (character === quote) quote = undefined
		else if (quote === undefined && character === '>') return index
	}
	return -1
}

function unsafeParagraphDescendant(tagName: string, tagSource: string): boolean {
	if (whitespaceSensitiveElementNames.has(tagName)) return true
	return attributeValue(tagSource, 'style') !== undefined
}

function attributeValue(tagSource: string, requestedName: string): string | undefined {
	const tagNameMatch = tagSource.match(/^<\s*\/?\s*[a-z][\w:-]*/i)
	let index = tagNameMatch?.[0].length ?? tagSource.length
	while (index < tagSource.length) {
		while (/\s/.test(tagSource[index] ?? '')) index += 1
		if (tagSource[index] === '>' || tagSource[index] === '/') break
		const nameStart = index
		while (index < tagSource.length && !/[\s=/>]/.test(tagSource[index] ?? '')) index += 1
		const name = tagSource.slice(nameStart, index).toLowerCase()
		while (/\s/.test(tagSource[index] ?? '')) index += 1
		let value = ''
		if (tagSource[index] === '=') {
			index += 1
			while (/\s/.test(tagSource[index] ?? '')) index += 1
			const quote = tagSource[index]
			if (quote === '"' || quote === "'") {
				index += 1
				const valueStart = index
				while (index < tagSource.length && tagSource[index] !== quote) index += 1
				value = tagSource.slice(valueStart, index)
				if (tagSource[index] === quote) index += 1
			} else {
				const valueStart = index
				while (index < tagSource.length && !/[\s>]/.test(tagSource[index] ?? '')) index += 1
				value = tagSource.slice(valueStart, index)
			}
		}
		if (name === requestedName) return value
	}
	return undefined
}

export function formatParagraphsOnSingleLines(html: string): string {
	let formattedHtml = html
	for (const span of paragraphSourceSpans(html).reverse()) {
		const paragraph = html.slice(span.start, span.end)
		const formattedParagraph = paragraph
			.replace(/\s*\r?\n\s*/g, ' ')
			.replace(/(<p\b[^>]*>)\s+/i, '$1')
			.replace(/\s+(<\/p>)$/i, '$1')
		formattedHtml = `${formattedHtml.slice(0, span.start)}${formattedParagraph}${formattedHtml.slice(span.end)}`
	}
	return formattedHtml
}

function trackedHtmlFilePaths(): string[] {
	const result = Bun.spawnSync(['git', 'ls-files', '-z', ':(glob)**/*.html'], { cwd: repositoryRootPath })
	if (result.exitCode !== 0) throw new Error(`Unable to list tracked HTML files: ${result.stderr.toString().trim()}`)
	return result.stdout
		.toString()
		.split('\0')
		.filter(Boolean)
		.map(filePath => path.join(repositoryRootPath, filePath))
}

export async function formatHtmlFiles(filePaths: string[], runPrettier: () => Promise<void>): Promise<void> {
	for (const filePath of filePaths) paragraphSourceSpans(await readFile(filePath, 'utf8'))
	await runPrettier()
	for (const filePath of filePaths) {
		const html = await readFile(filePath, 'utf8')
		const formattedHtml = formatParagraphsOnSingleLines(html)
		if (formattedHtml !== html) await writeFile(filePath, formattedHtml)
	}
}

if (import.meta.main) {
	await formatHtmlFiles(trackedHtmlFilePaths(), async () => {
		const prettier = Bun.spawn(['bun', 'x', 'prettier', '--write', '**/*.html'], {
			cwd: repositoryRootPath,
			stderr: 'inherit',
			stdout: 'inherit',
		})
		const exitCode = await prettier.exited
		if (exitCode !== 0) throw new Error(`Prettier exited with code ${exitCode}`)
	})
}
