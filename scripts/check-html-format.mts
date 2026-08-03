import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'
import { formatParagraphsOnSingleLines } from './format-html-prose.mts'

const repositoryRootPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

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

const unformattedFiles: string[] = []
for (const filePath of trackedHtmlFilePaths()) {
	const html = await readFile(filePath, 'utf8')
	const options = (await prettier.resolveConfig(filePath)) ?? {}
	const formattedHtml = formatParagraphsOnSingleLines(await prettier.format(html, { ...options, filepath: filePath, plugins: [] }))
	if (formattedHtml !== html) unformattedFiles.push(path.relative(repositoryRootPath, filePath))
}

if (unformattedFiles.length > 0) throw new Error(`HTML formatting differs in:\n${unformattedFiles.map(filePath => `- ${filePath}`).join('\n')}`)
console.log(`Validated readable formatting for ${trackedHtmlFilePaths().length} HTML files`)
