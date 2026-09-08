import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { formatHtmlFiles, formatParagraphsOnSingleLines } from './format-html-prose.mts'

describe('formatParagraphsOnSingleLines', () => {
	test('keeps inline elements with their surrounding prose', () => {
		const html = '<p>\n\tText before\n\t<code>value</code> and <a href="#target">after</a>.\n</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe('<p>Text before <code>value</code> and <a href="#target">after</a>.</p>\n')
	})

	test('preserves paragraphs that are already on one line', () => {
		const html = '<p class="summary">Already formatted.</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe(html)
	})

	test('ignores paragraph-like strings in comments', () => {
		const html = '<!-- <p>\nnot markup\n</p> -->\n<p>\nreal prose\n</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe('<!-- <p>\nnot markup\n</p> -->\n<p>real prose</p>\n')
	})

	for (const element of ['iframe', 'noembed', 'noframes', 'script', 'style', 'textarea', 'title', 'xmp']) {
		test(`ignores paragraph-like strings in <${element}>`, () => {
			const html = `<${element}><p>\nnot markup\n</p></${element}>\n<p>\nreal prose\n</p>\n`
			expect(formatParagraphsOnSingleLines(html)).toBe(`<${element}><p>\nnot markup\n</p></${element}>\n<p>real prose</p>\n`)
		})
	}

	test('treats everything after <plaintext> as text', () => {
		const html = '<plaintext><p>\nnot markup\n</p>\n<p>\nstill not markup\n</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe(html)
	})

	for (const element of ['iframe', 'noembed', 'noframes', 'plaintext', 'pre', 'script', 'style', 'textarea', 'title', 'xmp']) {
		test(`rejects whitespace-sensitive <${element}> descendants`, () => {
			expect(() => formatParagraphsOnSingleLines(`<p><${element}>a\n  b</${element}></p>`)).toThrow('whitespace-sensitive')
		})
	}

	test('rejects inline styles before interpreting CSS or character references', () => {
		expect(() => formatParagraphsOnSingleLines('<p><span style="white-space: pre">a\n  b</span></p>')).toThrow('whitespace-sensitive')
		expect(() => formatParagraphsOnSingleLines('<p><span style=white-space:pre>a\n  b</span></p>')).toThrow('whitespace-sensitive')
		expect(() => formatParagraphsOnSingleLines('<p><span style="white-space&#58; pre">a\n  b</span></p>')).toThrow('whitespace-sensitive')
		expect(() => formatParagraphsOnSingleLines('<p><span style=white-space&#58;pre>a\n  b</span></p>')).toThrow('whitespace-sensitive')
		expect(() => formatParagraphsOnSingleLines('<p><span style="color: red">a\n  b</span></p>')).toThrow('whitespace-sensitive')
	})

	test('does not mistake similarly named attributes for style', () => {
		const html = '<p>\n<span data-style="white-space: pre">ordinary text</span>\n</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe('<p><span data-style="white-space: pre">ordinary text</span></p>\n')
	})

	test('keeps inline MathML on the paragraph line', () => {
		const html = '<p>\n\tValue <math aria-label="x"><mi>x</mi></math>.\n</p>\n'
		expect(formatParagraphsOnSingleLines(html)).toBe('<p>Value <math aria-label="x"><mi>x</mi></math>.</p>\n')
	})

	test('rejects unsafe files before the formatter can write', async () => {
		const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'zoltar-html-format-'))
		const filePath = path.join(temporaryDirectory, 'unsafe.html')
		const originalHtml = '<p><span style=white-space:pre>a\n  b</span></p>\n'
		const safeFilePath = path.join(temporaryDirectory, 'safe.html')
		const safeHtml = '<p>safe</p>\n'
		let formatterRan = false
		try {
			await writeFile(filePath, originalHtml)
			await writeFile(safeFilePath, safeHtml)
			await expect(
				formatHtmlFiles([safeFilePath, filePath], async () => {
					formatterRan = true
					await writeFile(filePath, '<p>changed</p>\n')
					await writeFile(safeFilePath, '<p>changed</p>\n')
				}),
			).rejects.toThrow('whitespace-sensitive')
			expect(formatterRan).toBe(false)
			expect(await readFile(filePath, 'utf8')).toBe(originalHtml)
			expect(await readFile(safeFilePath, 'utf8')).toBe(safeHtml)
		} finally {
			await rm(temporaryDirectory, { recursive: true })
		}
	})
})
