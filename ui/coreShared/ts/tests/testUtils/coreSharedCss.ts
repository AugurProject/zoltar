import { readFileSync } from 'node:fs'
import * as path from 'node:path'

const CSS_IMPORT_PATTERN = /^@import url\(["'](.+?)["']\);$/gm

function readCssImportGraph(stylesheetPath: string, visitedPaths: Set<string>): string {
	const resolvedPath = path.resolve(stylesheetPath)
	if (visitedPaths.has(resolvedPath)) throw new Error(`Circular CSS import found at ${resolvedPath}`)
	visitedPaths.add(resolvedPath)
	const source = readFileSync(resolvedPath, 'utf8')
	const combinedSource = source.replace(CSS_IMPORT_PATTERN, (_statement, importedPath: string) => readCssImportGraph(path.resolve(path.dirname(resolvedPath), importedPath), visitedPaths))
	visitedPaths.delete(resolvedPath)
	return combinedSource
}

export function readCoreSharedCssSource() {
	return readCssImportGraph('ui/coreShared/css/index.css', new Set())
}
