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
	securityPoolCapitalCreationCodeFirstChunk: '0xfbda5e9147b8ab3802ce15a69261e355e2b270afe7dd3c19336ae41ef4cc0b2e',
	securityPoolCapitalCreationCodeSecondChunk: '0x110239a8955540074e26882f5349abdce4dd63ac7157c17313802c860afd7296',
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
	securityPoolCommitmentIndexImplementation: '0x06f30afeb4c5fc2cb77b6b66f06bbe20ac4d8fd7c798ab4fd6c4d808f0bae28e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xeccbf4c9387987288a3f8614993253d9e1182e214b2973321d2803832912255e',
		questionLedgerDeploymentWorker: '0xe0370fe0ad6c6431326a99a32c405f5d9c8b10ffd7ce2df974b73181af49016b',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb06804a3d0a2c2c0bebc9c8fb30a6927f4b0e665032c440943423abccd695b40',
		questionLedgerDeploymentWorker: '0x6a3f993a9bdea9c26ca15ec8bdfe7872a9bcee0e1a68e26521df66dfd35f9e85',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xdd9f88388005ce5b2c87c5104faa9ac6e0a373aeefaa5274dcafbe70aac22855',
		questionLedgerDeploymentWorker: '0x425dd29b19b0e5ae0c42a241ff939c14b3c7b3ed80c295ad4f3457b3348f334d',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x7f45ea91cc93de67c1cb61109d3a03c0ddf812abf66fc00d53e99c1241788399',
		questionLedgerDeploymentWorker: '0x0fd668e25945cc4a4f0d07c5cc1d6ee63f1090712a6f292387b9085796bfb58c',
	},
	deterministic: {
		questionLedgerDeployer: '0xcfa84e60404eadba1f47f8df72138d4eb9b8f9092ad20de3582c55d5e601cdc1',
		questionLedgerDeploymentWorker: '0xb15cf410d2086c99cec1ba72fd9f73e352745eea8f4aa400b65a7a9029f8f80b',
	},
	mainnet: {
		questionLedgerDeployer: '0x6f8fac2b42456c4e061caacb12710386d33cbb42952755012699dc43ca9c06f5',
		questionLedgerDeploymentWorker: '0xf145d7cb84c44f6b9fadced4109f9defc1e5f1fa8bf65ec0797f764fbdb5431e',
	},
}
