import { collectSourceFiles, readSource, projectPath } from './lint-source-files.mts'
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
const ignoredPathPrefixes = [
	'.git',
	'coverage',
	'node_modules',
	'shared/js',
	'shared/node_modules',
	'solidity/artifacts',
	'solidity/js',
	'solidity/node_modules',
	'ui/zoltar/dist',
	'ui/zoltar/js',
	'ui/zoltar/vendor',
	'ui/statoblast/dist',
	'ui/statoblast/js',
	'ui/statoblast/vendor',
	'ui/trading/dist',
	'ui/trading/js',
	'ui/trading/vendor',
]
const ignoredFiles = new Set(['solidity/ts/types/contractArtifact.ts', 'ui/coreShared/ts/contractArtifact.ts'])

function toProjectPath(filePath: string): string {
	return projectPath(repositoryRoot, filePath)
}

function isBlockedEthereumDependencySpecifier(specifier: string): boolean {
	return specifier === 'abitype' || specifier.startsWith('abitype/') || specifier === 'viem' || specifier.startsWith('viem/')
}

function findDirectViemImportFindings(sourceFile: ts.SourceFile): DirectViemImportFinding[] {
	const findings: DirectViemImportFinding[] = []
	const blockedSpecifierFrom = (node: ts.Expression): ts.StringLiteralLike | undefined => {
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isBlockedEthereumDependencySpecifier(node.text)) return node
		return undefined
	}
	const addFinding = (node: ts.Node, specifier: ts.StringLiteralLike): void => {
		const position = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile))
		findings.push({
			file: toProjectPath(sourceFile.fileName),
			importText: node.getText(sourceFile),
			line: position.line + 1,
			column: position.character + 1,
		})
	}

	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node)) {
			const specifier = blockedSpecifierFrom(node.moduleSpecifier)
			if (specifier !== undefined) addFinding(node, specifier)
		}

		if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
			const specifier = blockedSpecifierFrom(node.moduleSpecifier)
			if (specifier !== undefined) addFinding(node, specifier)
		}

		if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression !== undefined) {
			const specifier = blockedSpecifierFrom(node.moduleReference.expression)
			if (specifier !== undefined) addFinding(node, specifier)
		}

		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			const [firstArgument] = node.arguments
			if (firstArgument !== undefined) {
				const specifier = blockedSpecifierFrom(firstArgument)
				if (specifier !== undefined) addFinding(node, specifier)
			}
		}

		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && isBlockedEthereumDependencySpecifier(node.argument.literal.text)) {
			addFinding(node, node.argument.literal)
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

const blockedImportFixtures = [
	ts.createSourceFile(path.join(repositoryRoot, 'direct-viem-import-fixture.mjs'), "import { http } from 'viem'", ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
	ts.createSourceFile(path.join(repositoryRoot, 'direct-viem-require-fixture.cjs'), "const viem = require('viem')", ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
	ts.createSourceFile(path.join(repositoryRoot, 'direct-abitype-import-fixture.ts'), "import type { Abi } from 'abitype'", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
	ts.createSourceFile(path.join(repositoryRoot, 'direct-viem-import-fixture.d.ts'), "export type { Address } from 'viem'", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
	ts.createSourceFile(path.join(repositoryRoot, 'direct-viem-import-equals-fixture.ts'), "import viem = require('viem')", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
	ts.createSourceFile(path.join(repositoryRoot, 'direct-viem-template-import-fixture.mjs'), 'const viem = import(`viem`)', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
]
if (blockedImportFixtures.some(fixture => findDirectViemImportFindings(fixture).length !== 1)) throw new Error('Direct Ethereum dependency lint did not inspect every supported source form')

async function main() {
	const files = await collectSourceFiles(repositoryRoot, ignoredPathPrefixes, ignoredFiles)
	const findings: DirectViemImportFinding[] = []

	for (const filePath of files) {
		const sourceFile = await readSource(filePath)
		findings.push(...findDirectViemImportFindings(sourceFile))
	}

	if (findings.length === 0) return

	console.log("Direct 'viem' and 'abitype' imports are not allowed. Import from '@zoltar/shared/ethereum' instead.")
	for (const finding of findings) {
		console.log(`${finding.file}:${finding.line}:${finding.column} - ${finding.importText}`)
	}
	console.log(`\nFound ${findings.length} direct Ethereum dependency import(s).`)
	process.exitCode = 1
}

await main()
