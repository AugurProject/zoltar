/**
 * Canonical generated-output policy. Each entry names a repository-relative glob (Git `:(glob)` pathspec
 * syntax without a leading slash), whether Git tracks it, and how to recreate it.
 *
 * Outputs stay ignored unless a consumer must load them without a build step; each tracked output records
 * why and which command enforces its freshness. `bun run check:generated-policy` keeps `.gitattributes`,
 * `.gitignore`, and the Git index consistent with this list.
 */
type LinguistAttribute = 'generated' | 'vendored'

type IgnoredGeneratedArtifact = {
	readonly pattern: string
	readonly tracked: false
	/** Command that recreates the output. */
	readonly regenerate: string
	/** Linguist attribute that keeps accidental tracked diffs out of review views. */
	readonly linguist?: LinguistAttribute
}

type TrackedGeneratedArtifact = {
	readonly pattern: string
	readonly tracked: true
	/** Command or procedure that recreates the output. */
	readonly regenerate: string
	/** Why the output is committed instead of generated on demand. */
	readonly reason: string
	/** Command that verifies the committed output is fresh without rewriting it. */
	readonly check: string
	readonly linguist: LinguistAttribute
}

export type GeneratedArtifact = IgnoredGeneratedArtifact | TrackedGeneratedArtifact

const contractArtifactCommand = 'bun run compile-contracts'
const uiContractArtifactCommand = 'bun run generate (or bun run ui:build)'
const augurScanMetadataCommand = 'cd augurScan && bun run metadata:build (build, typecheck, and test entry points run it automatically)'
const documentationReason = 'The static documentation site loads it directly.'
const arbitragerReason = 'The arbitrager container image and tests resolve it without compiling Solidity.'
const arbitragerCheck = 'cd bots/open-oracle-arbitrager && bun run check:generated'

export const generatedArtifacts: readonly GeneratedArtifact[] = [
	{ pattern: 'shared/*/js/**', tracked: false, regenerate: 'bun run shared:build', linguist: 'generated' },
	{ pattern: 'shared/.freshness-hash', tracked: false, regenerate: 'bun run shared:build' },
	{ pattern: 'solidity/artifacts/**', tracked: false, regenerate: `${contractArtifactCommand} (one app: bun tooling/contracts/build-app-contracts.mts <app>)`, linguist: 'generated' },
	{ pattern: 'solidity/js/**', tracked: false, regenerate: contractArtifactCommand },
	{ pattern: 'solidity/.contract-hash.json', tracked: false, regenerate: contractArtifactCommand },
	{ pattern: 'solidity/ts/types/contractArtifact.ts', tracked: false, regenerate: contractArtifactCommand, linguist: 'generated' },
	{ pattern: 'ui/coreShared/ts/abis.ts', tracked: false, regenerate: uiContractArtifactCommand, linguist: 'generated' },
	{ pattern: 'ui/coreShared/ts/contractArtifact.ts', tracked: false, regenerate: uiContractArtifactCommand, linguist: 'generated' },
	{ pattern: 'ui/statoblastShared/ts/contractArtifact.ts', tracked: false, regenerate: uiContractArtifactCommand, linguist: 'generated' },
	{ pattern: 'ui/trading/ts/generated/contractArtifact.ts', tracked: false, regenerate: 'bun ./tooling/ui/vendor.mts trading (or bun run ui:vendor)', linguist: 'generated' },
	{ pattern: 'ui/*/js/**', tracked: false, regenerate: 'bun run ui:build', linguist: 'generated' },
	{ pattern: 'ui/*/dist/**', tracked: false, regenerate: 'bun run ui:build:prod', linguist: 'generated' },
	{ pattern: 'ui/*/vendor/**', tracked: false, regenerate: 'bun run ui:vendor', linguist: 'vendored' },
	{ pattern: 'augurScan/config/abis.json', tracked: false, regenerate: augurScanMetadataCommand },
	{ pattern: 'augurScan/config/system-contracts.generated.ts', tracked: false, regenerate: augurScanMetadataCommand },
	{ pattern: 'augurScan/config/manifests/*.json', tracked: false, regenerate: augurScanMetadataCommand },
	{ pattern: 'augurScan/public/app.js', tracked: false, regenerate: 'cd augurScan && bun run build:browser (also run by bun run build)' },
	{
		pattern: 'docs/assets/js/*.js',
		tracked: true,
		regenerate: 'bun run docs:build-runtime (runtime bundles), bun run docs:build-charts (chartRuntime.js), bun run docs:build-index (docsData.js, docsSearchData.js)',
		reason: documentationReason,
		check: 'bun run docs:check-runtime && bun run docs:check-charts && bun run docs:check-index',
		linguist: 'generated',
	},
	{ pattern: 'docs/reference/contracts.html', tracked: true, regenerate: 'bun run docs:generate-contract-reference', reason: documentationReason, check: 'bun run docs:check-contract-reference', linguist: 'generated' },
	{ pattern: 'docs/reference/contracts/*.html', tracked: true, regenerate: 'bun run docs:generate-contract-reference', reason: documentationReason, check: 'bun run docs:check-contract-reference', linguist: 'generated' },
	{ pattern: 'docs/assets/screenshots/**', tracked: true, regenerate: 'bun run docs:screenshots (captures tooling/docs/ui-screenshot-specs/<app>.mts from the walletless simulations)', reason: documentationReason, check: 'bun run docs:check-screenshots', linguist: 'generated' },
	{
		pattern: 'docs/*deployment-addresses.json',
		tracked: true,
		regenerate: 'bun ./tooling/contracts/check-mainnet-deployment.mts --write',
		reason: 'Documentation, bots, and the explorer load the canonical Yes and No deployments without compiling contracts.',
		check: 'bun run check:mainnet-deployment',
		linguist: 'generated',
	},
	{
		pattern: 'bots/shared/src/contracts/abi.generated.ts',
		tracked: true,
		regenerate: 'cd bots/shared && bun run generate:abi (or bun tooling/contracts/generate-bot-abis.mts)',
		reason: 'The liquidator and arbitrager container images resolve it without Solidity artifacts; local typecheck and test scripts still ensure the artifacts first.',
		check: 'cd bots/shared && bun run check:generated',
		linguist: 'generated',
	},
	{ pattern: 'bots/open-oracle-arbitrager/src/contracts/artifacts.generated.ts', tracked: true, regenerate: 'cd bots/open-oracle-arbitrager && bun run compile-contracts', reason: arbitragerReason, check: arbitragerCheck, linguist: 'generated' },
	{ pattern: 'bots/open-oracle-arbitrager/tests/contracts/harness-artifacts.generated.ts', tracked: true, regenerate: 'cd bots/open-oracle-arbitrager && bun run compile-contracts', reason: arbitragerReason, check: arbitragerCheck, linguist: 'generated' },
	{ pattern: 'bots/open-oracle-arbitrager/src/contracts/executor-abi.generated.ts', tracked: true, regenerate: 'cd bots/open-oracle-arbitrager && bun run generate:abi', reason: arbitragerReason, check: arbitragerCheck, linguist: 'generated' },
	{ pattern: 'bots/open-oracle-arbitrager/docs/chart-runtime.js', tracked: true, regenerate: 'cd bots/open-oracle-arbitrager && bun run build:docs', reason: 'The static operator guide loads it directly.', check: arbitragerCheck, linguist: 'generated' },
	{
		pattern: 'scripts/artifacts/uniswap-deployment.json',
		tracked: true,
		regenerate:
			"Vendored by hand: pinned Permit2, SwapRouter, and Uniswap V3/V4 bytecode from the upstream package versions recorded in the artifact (Permit2 and the SwapRouter deploy on every chain; the rest on deterministic testnets), plus Uniswap's published Sepolia WETH, V3 factory, QuoterV2, V4 PoolManager, and V4 Quoter creation transactions byte for byte with their runtime code hashes",
		reason: 'Pinning the deployment input keeps the large upstream Uniswap packages out of the lockfile.',
		check: 'bun run check:uniswap-deployment-artifact',
		linguist: 'generated',
	},
	{
		pattern: 'augurScan/config/dependency-abis.json',
		tracked: true,
		regenerate: 'Updated by hand with reviewed source URLs and SHA-256 pins in augurScan/config/dependency-abi-sources.json',
		reason: 'Builds verify these vendored ABIs against their tracked pins and must never download or rewrite them.',
		check: 'cd augurScan && bun run metadata:check',
		linguist: 'vendored',
	},
]

/** Git pathspec that matches every file covered by a registry pattern. */
export const generatedArtifactPathspec = (artifact: GeneratedArtifact) => `:(glob)${artifact.pattern}`

/** Pathspecs of outputs that must never be committed. */
export const untrackedGeneratedPathspecs = (registry: readonly GeneratedArtifact[] = generatedArtifacts) => registry.filter(artifact => !artifact.tracked).map(generatedArtifactPathspec)
