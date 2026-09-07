import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

export function projectPath(root: string, file: string) {
	return path.relative(root, file).replaceAll('\\', '/')
}

export async function collectSourceFiles(root: string, ignoredPrefixes: readonly string[], ignoredFiles: ReadonlySet<string>) {
	const files: string[] = []
	const ignored = (relative: string) => ignoredFiles.has(relative) || relative.split('/').includes('node_modules') || ignoredPrefixes.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))
	async function visit(directory: string) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			const fullPath = path.join(directory, entry.name)
			if (ignored(projectPath(root, fullPath))) continue
			if (entry.isDirectory()) await visit(fullPath)
			else if (entry.isFile() && sourceExtensions.has(path.extname(fullPath))) files.push(fullPath)
		}
	}
	await visit(root)
	return files
}

export function parseSource(file: string, text: string, typescriptOnly = false) {
	const extension = path.extname(file)
	let kind = ts.ScriptKind.TS
	if (typescriptOnly) {
		if (extension.endsWith('x')) kind = ts.ScriptKind.TSX
	} else if (extension === '.tsx') kind = ts.ScriptKind.TSX
	else if (extension === '.jsx') kind = ts.ScriptKind.JSX
	else if (['.js', '.mjs', '.cjs'].includes(extension)) kind = ts.ScriptKind.JS
	return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

export async function readSource(file: string, typescriptOnly = false) {
	return parseSource(file, await fs.readFile(file, 'utf8'), typescriptOnly)
}
