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
	questionLedgerCreationCodeFirstChunk: '0x15868d13b80fb30dba79cd96097ce00b64da02879718c10b42f3168b980c8a0c',
	questionLedgerCreationCodeSecondChunk: '0x8b6467cdb51e15fc044d3fa42ccbbd8dc0314e315f11fef8724509935195367d',
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
		questionLedgerDeployer: '0x66d4d34a5f0a50370059f87d397417095f79342b8c727c7b13f6407269944d86',
		questionLedgerDeploymentWorker: '0x4e352a2db80ea30bc1ed8c4fc69a3978dadce87f031fde61b839731b491e0dbf',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x48f7c7e41710a60d8f35156c19a793eea05998e95041e6654fddd2c914355e46',
		questionLedgerDeploymentWorker: '0x33d32c13e5d753c6715b92746a6afa7c982432d865a82abc9b1e872ee01414c4',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb7f8198312d6a9c59e5467c4a90183d89dcec8074a34cf1347a4ee6b9af83efa',
		questionLedgerDeploymentWorker: '0x3f7f07255e77bdb8c0ac0bbe3d489715520fdcf71ef54d8955527f82bb973f9e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xf10d4ae5a1383bc8865694be01155e183b43459e70870f762aa8914b93479a5e',
		questionLedgerDeploymentWorker: '0xcdbdc914791eea546f4835af5baa899dbe5dc7e7d4080da12849dca2a2b19478',
	},
	deterministic: {
		questionLedgerDeployer: '0x4f966a3e42d448612642aa864ea425d333ba3403ab00acd4e0bd660c09183d95',
		questionLedgerDeploymentWorker: '0x9f29826971ebe3716adfbba60f1cf8991be9df09e6f64243e741143d6aa9d894',
	},
	mainnet: {
		questionLedgerDeployer: '0xaaa198b09a61e3994e1943f6ce28de2189a4c6c9d19ff07ffd30b4aa0f00e9da',
		questionLedgerDeploymentWorker: '0xe5a34e0d4d979aa8c3b39b10dc42d9ce0942bc938dd7115cc6ab12fcfb6c4cdb',
	},
}
