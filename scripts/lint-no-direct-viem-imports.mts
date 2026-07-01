import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

type DirectViemImportFinding = {
	file: string
	importText: string
	line: number
	column: number
}

const repositoryRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const sourceFileExtensions = new Set(['.ts', '.tsx', '.mts', '.cts'])
const ignoredPathPrefixes = ['.git', 'coverage', 'node_modules', 'shared/js', 'shared/node_modules', 'solidity/artifacts', 'solidity/js', 'solidity/node_modules', 'ui/dist', 'ui/js', 'ui/node_modules', 'ui/vendor']
const ignoredFiles = new Set(['solidity/ts/types/contractArtifact.ts', 'ui/ts/contractArtifact.ts'])

function toProjectPath(filePath: string): string {
	return path.relative(repositoryRoot, filePath).replaceAll('\\', '/')
}

function shouldIgnore(relativePath: string): boolean {
	if (ignoredFiles.has(relativePath)) return true
	if (relativePath.split('/').includes('node_modules')) return true
	for (const prefix of ignoredPathPrefixes) {
		if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) return true
	}
	return false
}

function shouldCheck(filePath: string): boolean {
	if (!sourceFileExtensions.has(path.extname(filePath))) return false
	const relativePath = toProjectPath(filePath)
	return !shouldIgnore(relativePath)
}

async function collectFiles(directory: string, files: string[] = []): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name)
		const relativePath = toProjectPath(fullPath)
		if (entry.isDirectory()) {
			if (shouldIgnore(relativePath)) continue
			await collectFiles(fullPath, files)
			continue
		}
		if (entry.isFile() && shouldCheck(fullPath)) files.push(fullPath)
	}
	return files
}

function findDirectViemImportFindings(sourceFile: ts.SourceFile): DirectViemImportFinding[] {
	const findings: DirectViemImportFinding[] = []

	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'viem') {
			const position = sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile))
			findings.push({
				file: toProjectPath(sourceFile.fileName),
				importText: node.getText(sourceFile),
				line: position.line + 1,
				column: position.character + 1,
			})
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

async function main() {
	const files = await collectFiles(repositoryRoot)
	const findings: DirectViemImportFinding[] = []

	for (const filePath of files) {
		const text = await fs.readFile(filePath, 'utf8')
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, path.extname(filePath).endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
		if (sourceFile.isDeclarationFile) continue
		findings.push(...findDirectViemImportFindings(sourceFile))
	}

	if (findings.length === 0) return

	console.log("Direct 'viem' imports are not allowed outside the shared Ethereum wrapper. Import from '@zoltar/shared/ethereum' instead.")
	for (const finding of findings) {
		console.log(`${finding.file}:${finding.line}:${finding.column} - ${finding.importText}`)
	}
	console.log(`\nFound ${findings.length} direct 'viem' import(s).`)
	process.exitCode = 1
}

await main()
