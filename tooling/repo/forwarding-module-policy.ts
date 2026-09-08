import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

export const intentionalForwardingModules: Readonly<Record<string, string>> = {
	'bun-test-setup-solidity.ts': 'Solidity test preload bootstrap that installs the shared root test setup for the dedicated runner.',
	'augurScan/src/api.ts': 'Stable application entry point for the capability-based API implementation.',
	'augurScan/src/database.ts': 'Stable database facade preserving the ScannerDatabase and record API after decomposition.',
	'augurScan/src/ethereum.ts': 'Deployment boundary copied with AugurScan so its independently installed runtime shares the canonical EVM adapter.',
	'augurScan/src/indexer-runtime.ts': 'Stable indexer runtime facade over the separately owned lifecycle capabilities.',
	'augurScan/src/projections.ts': 'Stable projection facade preserving the public projection API after decomposition.',
	'bots/shared/src/ethereum.ts': 'Intentional bot package entry point composing shared EVM primitives with bot-specific clients and RPC resilience.',
	'ui/statoblast/ts/index.dev.ts': 'Development bootstrap whose side-effect imports enable live reload before starting the application.',
	'ui/statoblastShared/ts/features/security-pools/lib/securityPoolState.ts': 'Cohesive public capability facade over the security-pool state engine, axes, and types.',
	'ui/statoblastShared/ts/protocol/index.ts': 'Explicit package entry point exposing the supported Statoblast protocol surface to application leaves.',
	'ui/trading/ts/index.dev.ts': 'Development bootstrap whose side-effect imports enable live reload before starting the application.',
	'ui/tradingShared/ts/index.ts': 'Narrow package entry point preserving the independently buildable Trading shared-library boundary.',
	'ui/zoltar/ts/index.dev.ts': 'Development bootstrap whose side-effect imports enable live reload before starting the application.',
	'ui/zoltarShared/ts/protocol/index.ts': 'Explicit package entry point exposing the supported Zoltar protocol surface to application leaves.',
}

const ignoredDirectoryNames = new Set(['.git', 'artifacts', 'coverage', 'dist', 'js', 'node_modules', 'vendor'])
const sourceExtensionPattern = /\.(?:cts|mts|ts|tsx)$/

function isForwardingStatement(statement: ts.Statement) {
	return ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isNamespaceExportDeclaration(statement)
}

export function isForwardingModule(sourcePath: string, sourceText: string) {
	if (sourcePath.endsWith('.d.ts')) return false
	const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true)
	return sourceFile.statements.length > 0 && sourceFile.statements.every(isForwardingStatement)
}

async function sourceFilesUnder(directory: string): Promise<readonly string[]> {
	const files: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) files.push(...(await sourceFilesUnder(entryPath)))
		else if (entry.isFile() && sourceExtensionPattern.test(entry.name)) files.push(entryPath)
	}
	return files
}

export async function forwardingModules(repositoryRoot: string) {
	const sourcePaths = await sourceFilesUnder(repositoryRoot)
	const results: string[] = []
	for (const sourcePath of sourcePaths) {
		const relativePath = path.relative(repositoryRoot, sourcePath).split(path.sep).join('/')
		if (isForwardingModule(relativePath, await readFile(sourcePath, 'utf8'))) results.push(relativePath)
	}
	return results.sort()
}

export async function unapprovedForwardingModules(repositoryRoot: string) {
	const approved = new Set(Object.keys(intentionalForwardingModules))
	return (await forwardingModules(repositoryRoot)).filter(sourcePath => !approved.has(sourcePath))
}
