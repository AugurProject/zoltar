/**
 * Documentation that code or tests execute or read. CI scope classification and `check:affected` select each entry's
 * project alongside the documentation checks, and `test:plan` recommends each entry's tests, so both read this one table.
 */
export type DocumentationConsumer = {
	readonly projectId: string
	readonly reason: string
	readonly files?: readonly string[]
	readonly directories?: readonly string[]
	readonly pattern?: RegExp
	/** Test files that read or execute the matched documentation. */
	readonly tests: readonly string[]
}

export const documentationConsumers: readonly DocumentationConsumer[] = [
	{
		projectId: 'repository',
		reason: 'the documentation runtime, its compiled bundles, or its chart sources changed; root typechecking and the documentation runtime tests compile or execute them',
		directories: ['docs/runtime/', 'docs/assets/js/', 'docs/charts/'],
		files: ['docs/tsconfig.json'],
		tests: ['tooling/docs/documentation-tools-runtime.test.ts', 'tooling/docs/responsive-docs-runtime.test.ts'],
	},
	{
		projectId: 'repository',
		reason: 'a documentation page loaded by the documentation runtime tests changed',
		files: ['docs/explanation/escalation-game.html', 'docs/reference/deployment-status.html', 'docs/reference/invariants.html', 'docs/reference/merkle-mountain-range.html', 'docs/reference/open-oracle.html'],
		tests: ['tooling/docs/documentation-tools-runtime.test.ts'],
	},
	{
		projectId: 'repository',
		reason: 'developer documentation asserted by the UI split workflow test changed',
		files: ['README.md', 'testnetwork/README.md', 'docs/how-to/trading-set-up-development.html'],
		tests: ['tooling/ui/ui-split-workflows.test.ts'],
	},
	{
		projectId: 'augur-scan',
		reason: 'the augurScan README asserted by its packaging test changed',
		files: ['augurScan/README.md'],
		tests: ['augurScan/tests/unit/docker-packaging.test.ts'],
	},
	{
		// The arbitrager's check:docs also resolves the reference documents' fragment links into the shared bot guide.
		projectId: 'arbitrager',
		reason: 'a reference document served by the arbitrager dashboard, or the shared bot guide it links into, changed',
		files: ['bots/README.md'],
		pattern: /^bots\/open-oracle-arbitrager\/[^/]+\.md$/,
		tests: ['bots/open-oracle-arbitrager/tests/dashboard/dashboard-server.test.ts'],
	},
]

export const documentationConsumerMatches = (consumer: DocumentationConsumer, filePath: string) => consumer.files?.includes(filePath) === true || consumer.directories?.some(directory => filePath.startsWith(directory)) === true || consumer.pattern?.test(filePath) === true
