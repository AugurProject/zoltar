import path from 'node:path'

export const documentationRuntimeNames = ['auctionClearing', 'deploymentMaskDecoder', 'docsShell', 'interactiveTools', 'invariantExplorer', 'mmrProofPlanner', 'openOracleTools', 'responsiveDocs'] as const

export type DocumentationRuntimeName = (typeof documentationRuntimeNames)[number]

const generatedBanner = '// Generated from docs/runtime TypeScript by bun run docs:build-runtime. Do not edit.\n'

// Each runtime is bundled on its own so runtimes can share helpers through imports. The ESM format emits
// no wrapper, so top-level bindings stay reachable for tooling that evaluates the output as a script.
export async function buildDocumentationRuntime(name: DocumentationRuntimeName, sourceRoot: string): Promise<string> {
	const result = await Bun.build({
		entrypoints: [path.join(sourceRoot, `${name}.ts`)],
		format: 'esm',
		minify: false,
		target: 'browser',
	})
	if (!result.success) throw new AggregateError(result.logs, `Failed to bundle the ${name} documentation runtime`)
	const [output, ...extraOutputs] = result.outputs
	if (output === undefined || extraOutputs.length > 0) throw new Error(`The ${name} documentation runtime build must produce exactly one output`)
	return `${generatedBanner}${await output.text()}`
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
