import { readdir } from 'node:fs/promises'
import path from 'node:path'

async function collectDocumentPaths(directoryPath: string, relativeDirectory: string): Promise<string[]> {
	const entries = await readdir(directoryPath, { withFileTypes: true })
	const paths = await Promise.all(
		entries.map(async entry => {
			const relativePath = path.posix.join(relativeDirectory, entry.name)
			if (entry.isDirectory()) return collectDocumentPaths(path.join(directoryPath, entry.name), relativePath)
			return entry.isFile() && /\.(?:html|md)$/.test(entry.name) ? [relativePath] : []
		}),
	)
	return paths.flat()
}

export async function collectGroupedDocumentPaths(docsDirectory: string, directoryNames: readonly string[]): Promise<string[]> {
	return (await Promise.all(directoryNames.map(directoryName => collectDocumentPaths(path.join(docsDirectory, directoryName), directoryName)))).flat().toSorted()
}
