/**
 * Documentation that code or tests execute or read. CI scope classification and `check:affected` select each entry's
 * project alongside the documentation checks, and `test:plan` recommends each entry's tests and checks, so both read this one table.
 */
export type DocumentationConsumer = {
	readonly projectId: string
	readonly reason: string
	readonly files?: readonly string[]
	readonly directories?: readonly string[]
	readonly pattern?: RegExp
	/** Test files that read or execute the matched documentation. */
	readonly tests?: readonly string[]
	/** Check commands, other than tests, that read the matched documentation. */
	readonly checks?: readonly string[]
}

export const documentationConsumers: readonly DocumentationConsumer[] = [
	{
		projectId: 'repository',
		reason: 'the documentation runtime, its compiled bundles, or its chart sources changed; root typechecking and the documentation runtime tests compile or execute them',
		directories: ['docs/runtime/', 'docs/assets/js/', 'docs/charts/'],
		files: ['docs/tsconfig.json'],
		tests: ['tooling/docs/docs-shell-runtime.test.ts', 'tooling/docs/documentation-tools-runtime.test.ts', 'tooling/docs/responsive-docs-runtime.test.ts'],
	},
	{
		projectId: 'repository',
		reason: 'a documentation page loaded by the documentation tools runtime test changed',
		files: ['docs/explanation/escalation-game.html', 'docs/reference/deployment-status.html', 'docs/reference/invariants.html', 'docs/reference/merkle-mountain-range.html', 'docs/reference/open-oracle.html'],
		tests: ['tooling/docs/documentation-tools-runtime.test.ts'],
	},
	{
		// The pager test also loads the last page before the first section boundary of the manifest reading order.
		// documentation-consumers.test.ts derives that page from docs/manifest.json and requires it to be listed here.
		projectId: 'repository',
		reason: 'a documentation page loaded by the documentation shell runtime test changed',
		files: ['docs/documentation.html', 'docs/explanation/contract-architecture.html', 'docs/explanation/open-oracle.html', 'docs/explanation/system-overview.html', 'docs/reference/contracts.html', 'docs/reference/contracts/openoraclepricecoordinator.html'],
		tests: ['tooling/docs/docs-shell-runtime.test.ts'],
	},
	{
		projectId: 'repository',
		reason: 'developer launch instructions validated by the documentation content check changed',
		files: ['README.md', 'testnetwork/README.md', 'docs/how-to/trading-set-up-development.html'],
		checks: ['bun run docs:check-content'],
	},
	{
		projectId: 'augur-scan',
		reason: 'the augurScan README asserted by its packaging test changed',
		files: ['augurScan/README.md'],
		tests: ['augurScan/tests/unit/docker-packaging.test.ts'],
	},
	{
		projectId: 'arbitrager',
		reason: 'a reference document served by the arbitrager dashboard and validated by its documentation check changed',
		pattern: /^bots\/open-oracle-arbitrager\/[^/]+\.md$/,
		tests: ['bots/open-oracle-arbitrager/tests/dashboard/dashboard-server.test.ts'],
		checks: ['cd bots/open-oracle-arbitrager && bun run check:docs'],
	},
	{
		projectId: 'arbitrager',
		reason: 'the shared bot guide whose heading fragments the arbitrager documentation check resolves changed',
		files: ['bots/README.md'],
		checks: ['cd bots/open-oracle-arbitrager && bun run check:docs'],
	},
]

export const documentationConsumerMatches = (consumer: DocumentationConsumer, filePath: string) => consumer.files?.includes(filePath) === true || consumer.directories?.some(directory => filePath.startsWith(directory)) === true || consumer.pattern?.test(filePath) === true
