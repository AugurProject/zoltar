import path from 'node:path'

import ts from 'typescript'

export const documentationRuntimeNames = ['auctionClearing', 'deploymentMaskDecoder', 'docsShell', 'interactiveTools', 'invariantExplorer', 'mmrProofPlanner', 'openOracleTools', 'responsiveDocs'] as const

export type DocumentationRuntimeName = (typeof documentationRuntimeNames)[number]

const generatedBanner = '// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.\n'

export async function buildDocumentationRuntime(name: DocumentationRuntimeName, sourceRoot: string): Promise<string> {
	const sourcePath = path.join(sourceRoot, `${name}.ts`)
	if (name === 'auctionClearing') {
		const result = await Bun.build({
			entrypoints: [sourcePath],
			format: 'iife',
			minify: false,
			target: 'browser',
		})
		if (!result.success) throw new AggregateError(result.logs, 'Failed to bundle the auction documentation runtime')
		const output = result.outputs[0]
		if (output === undefined) throw new Error('Auction documentation runtime build produced no output')
		return `${generatedBanner}${await output.text()}`
	}
	const source = await Bun.file(sourcePath).text()
	const result = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.None,
			newLine: ts.NewLineKind.LineFeed,
			removeComments: false,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: sourcePath,
		reportDiagnostics: true,
	})
	const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
	if (errors.length > 0) {
		const host: ts.FormatDiagnosticsHost = {
			getCanonicalFileName: fileName => fileName,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => '\n',
		}
		throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, host))
	}
	return `${generatedBanner}${result.outputText}`
}

export async function findStaleDocumentationRuntime(sourceRoot: string, outputRoot: string): Promise<DocumentationRuntimeName[]> {
	const stale: DocumentationRuntimeName[] = []
	for (const name of documentationRuntimeNames) {
		const outputPath = path.join(outputRoot, `${name}.js`)
		const [expected, actual] = await Promise.all([buildDocumentationRuntime(name, sourceRoot), Bun.file(outputPath).text()])
		if (actual !== expected) stale.push(name)
	}
	return stale
}
