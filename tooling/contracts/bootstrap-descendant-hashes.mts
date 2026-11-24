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
	questionLedgerCreationCodeFirstChunk: '0x2597aa560d384f9d6dd18c2cfa8db67c74bf08a10248fd4fb4c3beabe2a7c169',
	questionLedgerCreationCodeSecondChunk: '0xb0342c765ac9509c566ce40c4bb6c79803ba6e0e5265d2be9aec895925a2052c',
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
		questionLedgerDeployer: '0x0fe1f5698b8bf97a139f4c88da9ee42e1723276f6f9dabd8f99bf3add4f4f5d7',
		questionLedgerDeploymentWorker: '0x522cace7e07045e853fb3bcd6d0e2531ff1a297b459915c006a74f4298889ede',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x2fa07dfa34469b056c09d10982334a72b5b69573292b39ce348579c9645d8ec4',
		questionLedgerDeploymentWorker: '0xe49f605a9ca60183edc4cc87d7f6e410f085be871a9b8f6f9130fa017f3082e9',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x3adc91281dea2cd7086a6497735d6dd220437394694ad5b5f27c8a395d5a93ed',
		questionLedgerDeploymentWorker: '0xec072d1722f40b4be14dc3e56dd2649ea62dca02bb2f87554dfdd490ddf5a4b4',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xc69c609f4de98a6945ba28cb5e2b319bb6bf8cf26724d21aa2879d9bbe8650e9',
		questionLedgerDeploymentWorker: '0x5b1425fccc994a9a64740337612e844facf032e17a33fed366dcc9c37d7b9f22',
	},
	deterministic: {
		questionLedgerDeployer: '0x104d303ffecaed5cd40aed0e3bae755c954932a137eb6b49223a3eb53dc30ce2',
		questionLedgerDeploymentWorker: '0xa28fc3566488d8c1921b1a2c91fd751a1851527b852754394e30b8b5f92afc34',
	},
	mainnet: {
		questionLedgerDeployer: '0xd2c3ce9377f5269543acd8b1f17c18750e46a842f89e8194c37f186886d86313',
		questionLedgerDeploymentWorker: '0xbe0fca6cc35bcc5d3381d4fadb7c76d55f08907df1dbbc389fe6c645c6c38f6f',
	},
}
