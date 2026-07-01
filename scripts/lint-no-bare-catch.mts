import * as path from 'node:path'
import * as url from 'node:url'
import { promises as fs } from 'node:fs'
import * as ts from 'typescript'

type CatchFinding = {
	file: string
	line: number
	column: number
	reason: 'general-error-swallow' | 'missing-binding' | 'unused-binding'
}

const repositoryRoot = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(repositoryRoot, '..')
const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const ignoredPathPrefixes = ['.git', 'node_modules', 'ui/node_modules', 'ui/dist', 'ui/vendor', 'ui/js', 'shared/js', 'solidity/artifacts', 'solidity/js', 'solidity/node_modules', 'coverage']
const ignoredFiles = new Set(['solidity/ts/testsuite/simulator/types/wire-types.js'])

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

function catchBindingIsReferenced(block: ts.Block, bindingName: string) {
	let referenced = false
	const visit = (node: ts.Node): void => {
		if (referenced) return
		if (ts.isIdentifier(node) && node.text === bindingName) {
			referenced = true
			return
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(block, visit)
	return referenced
}

function isNegatedInstanceofExpression(expression: ts.Expression, bindingName: string) {
	if (!ts.isParenthesizedExpression(expression)) return false
	if (!ts.isBinaryExpression(expression.expression)) return false
	if (expression.expression.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword) return false
	return ts.isIdentifier(expression.expression.left) && expression.expression.left.text === bindingName
}

function isNegatedExpectedInstanceof(expression: ts.Expression, bindingName: string): boolean {
	if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
		return isNegatedInstanceofExpression(expression.operand, bindingName)
	}
	return false
}

function isGeneralErrorSwallowCondition(expression: ts.Expression, bindingName: string): boolean {
	if (isNegatedExpectedInstanceof(expression, bindingName)) {
		const operand = (expression as ts.PrefixUnaryExpression).operand
		if (!ts.isParenthesizedExpression(operand) || !ts.isBinaryExpression(operand.expression)) return false
		return ts.isIdentifier(operand.expression.right) && operand.expression.right.text === 'Error'
	}

	if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return false
	return isGeneralErrorSwallowCondition(expression.left, bindingName) || isGeneralErrorSwallowCondition(expression.right, bindingName)
}

function catchClauseSilencesGeneralErrors(node: ts.CatchClause) {
	if (node.variableDeclaration === undefined) return false
	if (!ts.isIdentifier(node.variableDeclaration.name)) return false
	const [firstStatement] = node.block.statements
	if (firstStatement === undefined || !ts.isIfStatement(firstStatement) || firstStatement.elseStatement !== undefined) return false
	if (!isGeneralErrorSwallowCondition(firstStatement.expression, node.variableDeclaration.name.text)) return false

	const thenStatement = firstStatement.thenStatement
	if (!ts.isThrowStatement(thenStatement)) return false
	return ts.isIdentifier(thenStatement.expression) && thenStatement.expression.text === node.variableDeclaration.name.text
}

function findCatchFindings(sourceFile: ts.SourceFile): CatchFinding[] {
	const matches: CatchFinding[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isCatchClause(node)) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.getStart())
			if (node.variableDeclaration === undefined) {
				matches.push({
					file: sourceFile.fileName,
					line: position.line + 1,
					column: position.character + 1,
					reason: 'missing-binding',
				})
			} else if (catchClauseSilencesGeneralErrors(node)) {
				matches.push({
					file: sourceFile.fileName,
					line: position.line + 1,
					column: position.character + 1,
					reason: 'general-error-swallow',
				})
			} else if (ts.isIdentifier(node.variableDeclaration.name) && !catchBindingIsReferenced(node.block, node.variableDeclaration.name.text)) {
				matches.push({
					file: sourceFile.fileName,
					line: position.line + 1,
					column: position.character + 1,
					reason: 'unused-binding',
				})
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return matches
}

async function main(): Promise<void> {
	const files = await collectFiles(projectRoot)
	const catchFindings: CatchFinding[] = []

	for (const filePath of files) {
		const text = await fs.readFile(filePath, 'utf8')
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, path.extname(filePath).endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
		catchFindings.push(...findCatchFindings(sourceFile))
	}

	if (catchFindings.length === 0) return

	const toRelative = (filePath: string): string => path.relative(projectRoot, filePath)

	for (const finding of catchFindings) {
		let message = 'Unexpected catch that swallows all Error instances; only silence specific targeted errors'
		if (finding.reason === 'missing-binding') {
			message = 'Unexpected catch without binding; use catch (error) and narrow the error explicitly'
		} else if (finding.reason === 'unused-binding') {
			message = 'Unexpected catch binding that is never used; narrow the error explicitly or rethrow unexpected values'
		}
		console.log(`${toRelative(finding.file)}:${finding.line}:${finding.column} - ${message}`)
	}

	console.log(`\nFound ${catchFindings.length} catch clause(s) that violate repository catch rules. Silent catch-all clauses are not allowed by repository lint rules.`)
	process.exitCode = 1
}

await main()
