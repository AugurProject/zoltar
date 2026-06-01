import * as path from 'node:path'
import * as url from 'node:url'
import { promises as fs } from 'node:fs'
import * as ts from 'typescript'

type BareCatch = {
	file: string
	line: number
	column: number
}

const repositoryRoot = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(repositoryRoot, '..')
const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const ignoredPathPrefixes = ['.git', 'node_modules', 'ui/node_modules', 'ui/dist', 'ui/vendor', 'ui/js', 'shared/js', 'solidity/artifacts', 'solidity/js', 'solidity/node_modules', 'coverage']
const ignoredFiles = new Set(['solidity/ts/testsuite/simulator/types/wire-types.js'])

function shouldIgnore(relativePath: string): boolean {
	if (ignoredFiles.has(relativePath)) return true
	for (const prefix of ignoredPathPrefixes) {
		if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) return true
	}
	return false
}

function shouldCheck(filePath: string): boolean {
	if (!sourceFileExtensions.has(path.extname(filePath))) return false
	const relativePath = path.relative(projectRoot, filePath).replaceAll('\\', '/')
	return !shouldIgnore(relativePath)
}

async function collectFiles(directory: string, files: string[] = []): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name)
		const relativePath = path.relative(projectRoot, fullPath).replaceAll('\\', '/')
		if (entry.isDirectory()) {
			if (shouldIgnore(relativePath)) continue
			await collectFiles(fullPath, files)
			continue
		}
		if (entry.isFile() && shouldCheck(fullPath)) files.push(fullPath)
	}
	return files
}

function findBareCatchClauses(sourceFile: ts.SourceFile): BareCatch[] {
	const matches: BareCatch[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isCatchClause(node) && node.variableDeclaration === undefined) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.getStart())
			matches.push({
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
			})
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return matches
}

async function main(): Promise<void> {
	const files = await collectFiles(projectRoot)
	const bareCatchFindings: BareCatch[] = []

	for (const filePath of files) {
		const text = await fs.readFile(filePath, 'utf8')
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, path.extname(filePath).endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
		bareCatchFindings.push(...findBareCatchClauses(sourceFile))
	}

	if (bareCatchFindings.length === 0) return

	const toRelative = (filePath: string): string => path.relative(projectRoot, filePath)

	for (const finding of bareCatchFindings) {
		console.log(`${toRelative(finding.file)}:${finding.line}:${finding.column} - Unexpected catch without binding; use catch (error) instead`)
	}

	console.log(`\nFound ${bareCatchFindings.length} catch clause(s) without a binding (catch (_error) { ... }). These are not allowed by repository lint rules.`)
	process.exitCode = 1
}

await main()
