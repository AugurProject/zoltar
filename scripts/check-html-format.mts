import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'
import { formatParagraphsOnSingleLines, repositoryHtmlFilePaths } from './format-html-prose.mts'

const repositoryRootPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const unformattedFiles: string[] = []
const htmlFilePaths = repositoryHtmlFilePaths().toSorted()
for (const filePath of htmlFilePaths) {
	const html = await readFile(filePath, 'utf8')
	const options = (await prettier.resolveConfig(filePath)) ?? {}
	const formattedHtml = formatParagraphsOnSingleLines(await prettier.format(html, { ...options, filepath: filePath, plugins: [] }))
	if (formattedHtml !== html) unformattedFiles.push(path.relative(repositoryRootPath, filePath))
}

if (unformattedFiles.length > 0) throw new Error(`HTML formatting differs in:\n${unformattedFiles.map(filePath => `- ${filePath}`).join('\n')}`)
console.log(`Validated readable formatting for ${htmlFilePaths.length} HTML files`)
