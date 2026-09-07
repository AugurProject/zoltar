import { collectSourceFiles, readSource } from './lint-source-files.mts'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

type CatchFinding = {
	file: string
	line: number
	column: number
	reason: 'general-error-swallow' | 'missing-binding' | 'unused-binding'
}

const repositoryRoot = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(repositoryRoot, '..')
const ignoredPathPrefixes = [
	'.git',
	'node_modules',
	'ui/coreShared/node_modules',
	'ui/zoltar/node_modules',
	'ui/statoblast/node_modules',
	'ui/zoltar/dist',
	'ui/statoblast/dist',
	'ui/zoltar/vendor',
	'ui/statoblast/vendor',
	'ui/trading/vendor',
	'ui/zoltar/js',
	'ui/statoblast/js',
	'ui/trading/js',
	'shared/js',
	'solidity/artifacts',
	'solidity/js',
	'solidity/node_modules',
	'ui/trading/dist',
	'ui/trading/ts/generated',
	'coverage',
]
const ignoredFiles = new Set(['solidity/ts/testSupport/simulator/types/wire-types.js'])

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
	const files = await collectSourceFiles(projectRoot, ignoredPathPrefixes, ignoredFiles)
	const catchFindings: CatchFinding[] = []

	for (const filePath of files) {
		const sourceFile = await readSource(filePath, true)
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
