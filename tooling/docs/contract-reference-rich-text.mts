import assert from 'node:assert/strict'
import path from 'node:path'
import { contractPagesDirectory, outputPath } from './contract-reference-metadata.mts'
import { repositorySourceUrl } from './repository-source-links.mts'

export function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

// Metadata prose supports `code` spans and [label](destination) links; everything else is escaped text.
export function renderRichText(value: string, pageOutputPath: string = contractPagesDirectory): string {
	let output = ''
	let offset = 0
	for (const match of value.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g)) {
		const index = match.index
		output += escapeHtml(value.slice(offset, index))
		const code = match[1]
		const label = match[2]
		const href = match[3]
		if (code !== undefined) output += `<code>${escapeHtml(code)}</code>`
		else {
			assert(label !== undefined && href !== undefined, 'rich-text link must provide a label and destination')
			output += `<a href="${escapeHtml(resolveRichTextHref(href, pageOutputPath))}">${escapeHtml(label)}</a>`
		}
		offset = index + match[0].length
	}
	return output + escapeHtml(value.slice(offset))
}

// Metadata links are written relative to docs/reference; deeper pages prefix the extra ancestors, and repository paths render through GitHub.
function resolveRichTextHref(href: string, pageOutputPath: string): string {
	if (href.startsWith('#') || /^https?:/.test(href)) return href
	if (!href.startsWith('./') && !href.startsWith('../')) return repositorySourceUrl(href)
	const pageDirectory = pageOutputPath.endsWith('.html') ? path.posix.dirname(pageOutputPath) : pageOutputPath
	const ancestorPrefix = path.posix.relative(pageDirectory, path.posix.dirname(outputPath))
	return ancestorPrefix.length === 0 ? href : `${ancestorPrefix}/${href.replace(/^\.\//, '')}`
}

export function headingId(value: string): string {
	return value
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
}
