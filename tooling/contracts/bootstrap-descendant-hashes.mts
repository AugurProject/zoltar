import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the question ledger deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0x1f17bdabbdff2f2110ccbaaece91e9855f724389305b54595e302a4f6c238f9c',
	escalationGameCreationCodePartTwo: '0xd2d7fd9aa293d027bd67dae8117c98f95edc50fede0653fb35b77eeda6665cae',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x6cdf8df97f97d60620cabb20ec33b5390f5825e35b4d40fb43877eeefc4e9b17',
	securityPoolAuctionCreationCodeSecondChunk: '0xf611057ce2fcdd1f4bdd3c87d451b7e5ef207b2e8ded1585d7c77a4cd6e8a32d',
	securityPoolAuctionVaultImplementation: '0x9de92ef573ade6c6a9116be69c4b1bbbfd0ea01a198c079d8cec6c84894164f5',
	securityPoolCapitalCreationCodeFirstChunk: '0x3bc5eead13bc196959284409173cc7037734af3d63855acbbcf2dbdbf63a8069',
	securityPoolCapitalCreationCodeSecondChunk: '0x2d2c65c6eedc5263d36cd14ea8e7be496506799bdd7eae593cf8e5811ffe3639',
	questionLedgerCreationCodeFirstChunk: '0x0f5eff92e0a7d0dc52e49ba21ad42af63e8e1a15238407246bef054f01e2bbf7',
	questionLedgerCreationCodeSecondChunk: '0xbabfb855c3f69592c03179c000fb2232453057149e4ce86ff4907cb8609a2a41',
	securityPoolForkCreationCodeFirstChunk: '0xb29554e4d905d71aef02d60ce0e0e3b3de3a8b5ab2eebadfaf6d078917a3bb99',
	securityPoolForkCreationCodeSecondChunk: '0xc97d84d12af29c8d051ae372923ea5cf58ec9952fd2d1f1e3c5792398933cdde',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x2e91021f2ff0f6a887d8d7c1a6082e59ffe01a949a1c9dc0c326e98f0d9fa2d7',
		questionLedgerDeploymentWorker: '0x45f0493bf1ba2070e628359735b5730a6ca4671ac23e92a29928be4b1b5609e3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x0f4960eec98ce3ec47ba493c59ad8295f340142220b157a74fb79ab2de2ccdca',
		questionLedgerDeploymentWorker: '0x1ec51ef980747addcd25bec3f62fa81a67ea8422216820749860ca3d32b68ace',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xc3fc3f00efbba872c5fb13dafb77897a1483bd521b4c30d2da57058b42ebd5c1',
		questionLedgerDeploymentWorker: '0x7aee8a6d0413513a00a5eb8ce4dd483e357d4a7933a5cb97884c997c63d75932',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x572414313d29a2f3db960d9dd5fd23152a10f1730c7bcf83c8961736079a5e3f',
		questionLedgerDeploymentWorker: '0xe868740ea59c7204cc7d23a231f0d2d7c2aa9759275056a4b81b4d69eaddb215',
	},
	deterministic: {
		questionLedgerDeployer: '0x9c887e599943d4bb5c5c22d4f1eaedf9ca76566cc310575c9497045752f2498e',
		questionLedgerDeploymentWorker: '0xb0948e0064add43c667ebacd81bcdddb837eb19cd2b0b501d069fd14c8ef54a6',
	},
	mainnet: {
		questionLedgerDeployer: '0xb5729ae7ab5a7e8dad550318478e458d4a718f3f1724341fe744d14e968ba5b0',
		questionLedgerDeploymentWorker: '0x237948c73bc2b7d3011ce0984060985c2b132519cfe204f2777e3296111b9a5f',
	},
}
