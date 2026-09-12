import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

/**
 * Biome's noRestrictedImports (biome.json) rejects every import-syntax form of viem and abitype, but it does not visit
 * TypeScript inline import types such as `import('viem').Address`, substitution-free template-literal specifiers, or
 * `require()` calls with a subpath. This lint closes exactly those forms so the shared EVM boundary stays complete.
 */
const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const restrictedPackages = ['viem', 'abitype']
const sourceExtensions = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/
// Mirrors the generated output biome.json and the nested package configurations exclude, so both checks skip the same files.
const generatedPathPattern =
	/(?:^|\/)(?:vendor|dist|node_modules)\/|^(?:shared\/[^/]+|ui\/[^/]+|solidity|docs\/assets)\/js\/|^(?:coverage|reth|testnetwork)\/|^solidity\/artifacts\/|^bots\/open-oracle-arbitrager\/docs\/chart-runtime\.js$|^augurScan\/public\/app\.js$|^solidity\/ts\/testSupport\/simulator\/types\/wire-types\.js$/

type RestrictedImportTypeFinding = { file: string; line: number; column: number; text: string }

function scriptKindFor(file: string): ts.ScriptKind {
	if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
	if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
	return /\.(?:cjs|js|mjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

function isRestrictedSpecifier(specifier: string): boolean {
	return restrictedPackages.some(name => specifier === name || specifier.startsWith(`${name}/`))
}

function findRestrictedImportTypes(sourceFile: ts.SourceFile): RestrictedImportTypeFinding[] {
	const findings: RestrictedImportTypeFinding[] = []
	const record = (node: ts.Node, specifier: ts.Node) => {
		const position = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile))
		findings.push({ file: sourceFile.fileName, line: position.line + 1, column: position.character + 1, text: node.getText(sourceFile) })
	}
	const visit = (node: ts.Node): void => {
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && isRestrictedSpecifier(node.argument.literal.text)) record(node, node.argument.literal)
		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			const [specifier] = node.arguments
			const isRequire = node.expression.kind !== ts.SyntaxKind.ImportKeyword
			// Biome already reports string-literal `require('viem')`; only subpath require calls and template literals are missing there.
			if (specifier !== undefined && (ts.isNoSubstitutionTemplateLiteral(specifier) || (isRequire && ts.isStringLiteral(specifier) && specifier.text.includes('/'))) && isRestrictedSpecifier(specifier.text)) record(node, specifier)
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return findings
}

const fixtures: readonly [file: string, source: string, expectedFindings: number][] = [
	['fixture.ts', "export type Value = import('viem').Address", 1],
	['fixture.d.ts', "export type Module = typeof import('abitype/zod')", 1],
	['fixture.mjs', 'export const chains = import(`viem/chains`)', 1],
	['fixture.cjs', 'module.exports = require(`viem`)', 1],
	['fixture.cjs', "module.exports = require('viem/actions')", 1],
	['fixture.cjs', "module.exports = require('viem')", 0],
	['fixture.ts', "export const value = import('viem')", 0],
	['fixture.ts', "export type Local = import('./local.js').Value", 0],
	['fixture.ts', "import { http } from 'viem'\nexport const value = http", 0],
]
for (const [file, source, expectedFindings] of fixtures) {
	const count = findRestrictedImportTypes(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file))).length
	if (count !== expectedFindings) throw new Error(`Restricted import-type lint self-test failed for ${JSON.stringify(source)}: expected ${expectedFindings}, found ${count}`)
}

/**
 * Lists the tracked and untracked-but-not-ignored files under the requested paths (the whole repository by default) that
 * still exist as regular files, so deleted-but-unstaged files and gitignored generated output are skipped.
 */
async function worktreeFiles(requestedPaths: readonly string[]): Promise<string[]> {
	for (const requestedPath of requestedPaths) {
		const stat = await fs.stat(path.resolve(requestedPath)).catch(() => undefined)
		if (stat === undefined) throw new Error(`Cannot lint ${requestedPath}: the path does not exist`)
		if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Cannot lint ${requestedPath}: the path is not a file or directory`)
	}
	const pathArguments = requestedPaths.map(requestedPath => path.resolve(requestedPath))
	const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathArguments], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		.split('\0')
		.filter(file => file !== '')
	const stats = await Promise.all(listed.map(file => fs.stat(path.join(repositoryRoot, file)).catch(() => undefined)))
	return listed.filter((_, index) => stats[index]?.isFile() === true)
}

if (import.meta.main) {
	// Explicit paths (relative to the working directory or absolute, files or directories) lint just those files; without
	// arguments the whole worktree is linted.
	const files = await worktreeFiles(process.argv.slice(2))
	const findings: RestrictedImportTypeFinding[] = []
	for (const listedFile of files) {
		const file = listedFile.split(path.sep).join('/')
		if (!sourceExtensions.test(file) || generatedPathPattern.test(file)) continue
		const text = await fs.readFile(path.join(repositoryRoot, file), 'utf8')
		findings.push(...findRestrictedImportTypes(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))))
	}
	if (findings.length > 0) {
		console.log("Inline import types, template-literal specifiers, and subpath require() calls for 'viem' and 'abitype' are not allowed. Import EVM primitives through the shared boundary ('@zoltar/core-shared/evm/ethereum', or 'src/ethereum.ts' inside AugurScan) instead.")
		for (const finding of findings) console.log(`${finding.file}:${finding.line}:${finding.column} - ${finding.text}`)
		process.exitCode = 1
	}
}
