import path from 'node:path'

import ts from 'typescript'

export const documentationRuntimeNames = ['docsShell', 'responsiveDocs', 'interactiveTools', 'invariantExplorer', 'mmrProofPlanner'] as const

export type DocumentationRuntimeName = (typeof documentationRuntimeNames)[number]

const generatedBanner = '// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.\n'

export async function buildDocumentationRuntime(name: DocumentationRuntimeName, sourceRoot: string): Promise<string> {
	const sourcePath = path.join(sourceRoot, `${name}.ts`)
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
