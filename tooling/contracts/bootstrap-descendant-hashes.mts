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
	securityPoolCapitalCreationCodeFirstChunk: '0x8d5baa8afc2c9350cafb03e05bdc662f82d8fdb8620949d7d7c47d4201734adf',
	securityPoolCapitalCreationCodeSecondChunk: '0x62ddfa30c1f9169442009ff5c08828fb025c2f74fb08a7d709384db7527fbc11',
	questionLedgerCreationCodeFirstChunk: '0xc5f6f4fce0c7cb1284dc8183524c90cbf1818716228be7ee7998fe42a8de3152',
	questionLedgerCreationCodeSecondChunk: '0xbb5ccbf5a4e880dd2ee9fdad9785c27c2d8ba16efe4c981d6d552da5a17bb240',
	securityPoolForkCreationCodeFirstChunk: '0xb29554e4d905d71aef02d60ce0e0e3b3de3a8b5ab2eebadfaf6d078917a3bb99',
	securityPoolForkCreationCodeSecondChunk: '0xc97d84d12af29c8d051ae372923ea5cf58ec9952fd2d1f1e3c5792398933cdde',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa73ba8fad09d931c476dc8eb2b61d53eb70e68b3874a9403aa638b91747a5768',
		questionLedgerDeploymentWorker: '0x54adf705449a9d3420313b77691421789fcfa91cd749f55359ae35fe5419bbed',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb50a4335ea09c80642cdd258319f6e1016be6f3829ab0bc7656ba2e8bb9758ab',
		questionLedgerDeploymentWorker: '0x76d1fffaaab4ff415cae9d4805357e0ce92c0f7a84556637160f152d384ac916',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x9621be0dec491271d89cf849620757053e18807b19fba52066e002935cd76e76',
		questionLedgerDeploymentWorker: '0x4b3f1e217eaf8ec943f2e361a9d992bbc856edbd2f0bb2f7e9cc1c6f0a8030d2',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xfa9730f3de6515e351c186a27ddfdcc3b3809dc4823991e09b71c3f7942f808c',
		questionLedgerDeploymentWorker: '0xcffeff9a7fe1fcd4067200bc7996b4ea7b7f1f3f7e2555671e74fb7f21024551',
	},
	deterministic: {
		questionLedgerDeployer: '0x1b90310d7c81db5b10222b3014bbb323d7d63d69f484d7427c875b1cb1f55438',
		questionLedgerDeploymentWorker: '0x8ed55b3e328b8efea94a3b8ed59ea16a8af854f029d32102d6ce0eb57d1959b8',
	},
	mainnet: {
		questionLedgerDeployer: '0xa51f339355508c5a02667dc25a9e3c9ab69b6a6376d1242af7d8ffa410ac4639',
		questionLedgerDeploymentWorker: '0xe4aba6e84670271333822751f7c896351a4af585e5448a8923875a219e610793',
	},
}
