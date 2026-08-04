import { Element, Node, Window } from 'happy-dom'

const blockTags = new Set(['article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'])
const ignoredTags = new Set(['noscript', 'script', 'style', 'template'])

export function htmlToDocumentationText(source: string): string {
	const window = new Window()
	window.document.write(source)
	window.document.close()
	const root = window.document.querySelector('main') ?? window.document.body

	const renderNode = (node: Node): string => {
		if (node.nodeType === window.Node.TEXT_NODE) return node.textContent ?? ''
		if (!(node instanceof Element)) return ''
		const tagName = node.tagName.toLowerCase()
		if (ignoredTags.has(tagName)) return ''
		const content = Array.from(node.childNodes)
			.map(child => renderNode(child))
			.join('')
		if (tagName === 'a') return `${content} (${node.getAttribute('href') ?? ''})`
		if (tagName === 'code') return `\`${content.replace(/\s+/g, ' ').trim()}\``
		if (tagName === 'br') return '\n'
		if (tagName === 'tr') {
			const cells = Array.from(node.querySelectorAll(':scope > th, :scope > td')).map(cell => renderNode(cell).replace(/\s+/g, ' ').trim())
			return `\n${cells.join('\t')}\n`
		}
		return blockTags.has(tagName) ? `\n${content}\n` : content
	}

	const text = renderNode(root)
		.split('\n')
		.map(line => line.replace(/[ \f\r\v]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
	window.close()
	return text
}
