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
	securityPoolCapitalAuctionDelegate: '0x0e84ea264e030bd24429af5dc1440a3dbe9492dcc00260db8d577bdddb7b4947',
	securityPoolCapitalLifecycleDelegate: '0x010d3d0498469f0e39bb5f6f479c1ab1fa4d5bd38a7375bca379386f951f0502',
	escalationGameCreationCodePartOne: '0x9582a749eb98b9d3eb028db8ac19f263707d7e43854a2e0c3f865cea80c2c1cb',
	escalationGameCreationCodePartTwo: '0x2bc272d7e3961969d3bd2ddea3705232f62d8b460e90afadf678f673ef1fd61a',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x12ccc99032df2497ef823f3705ae8ed258bf3fe2ec8f08164c38a1221e39d55f',
	securityPoolAuctionCreationCodeSecondChunk: '0x2aadfffac4f84229eb0b88498ed8cc7b18804179ffd9c699031a13fc31486ca0',
	securityPoolAuctionVaultImplementation: '0x9de92ef573ade6c6a9116be69c4b1bbbfd0ea01a198c079d8cec6c84894164f5',
	securityPoolCapitalCreationCodeFirstChunk: '0x8d5baa8afc2c9350cafb03e05bdc662f82d8fdb8620949d7d7c47d4201734adf',
	securityPoolCapitalCreationCodeSecondChunk: '0x62ddfa30c1f9169442009ff5c08828fb025c2f74fb08a7d709384db7527fbc11',
	questionLedgerCreationCodeFirstChunk: '0xac408391e8b60ec13b97bbcf97d2ee126d828a5561f87f3abcfa87df2718509d',
	questionLedgerCreationCodeSecondChunk: '0x5bf40e8ef537f3a70310e42e81a50fbd2d4a773fb2917efb6af9a66bc6f3f1f9',
	securityPoolForkCreationCodeFirstChunk: '0xfab8deb0e4eb42dce68161d504800451cad3e02d72767b6a6f6ef7a2b57b3114',
	securityPoolForkCreationCodeSecondChunk: '0x93dd449509d04c46d888d905f3b36b9d631c3505fe4589f15e10b7efd18099ca',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0x370a1c9ef5398165e1e7c5adbb892b6d28b6bdbda95e89d2d648ee62a6dc3783',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xf4a586bcf6b9ce6229dcfa97c59ae1b6d3537bc2aab72196668ba0497ba6716a',
		questionLedgerDeploymentWorker: '0x9bd1af5b1f1bb4d2f85d9029e1b1e38236babdace6da44683534d664281deee3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x991c88217648fcb745325f01f6abf88f6b5f159b52443bae6379c34fce33f5c6',
		questionLedgerDeploymentWorker: '0x3b5beb0dbfd58c1786cc33ede423e7f8819afa1d2a28e8439c5e646b05a84286',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x70850e84a08a1d2ef2d63b07067b8ff733e1b690f14a293418b53b649f7f75d3',
		questionLedgerDeploymentWorker: '0x1bf0c914430ca7b0c253e2a607b35027f16ab213597534ea2455f23467402a43',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x6fcd5d98fc011135398b5ff698bb4f8bda6179ee321297e4d2fc94a5df47f501',
		questionLedgerDeploymentWorker: '0xa6ad9fada5fa1bec4b47addb1581486a1beb3d6b7309962b09ad1cb88aa3b432',
	},
	deterministic: {
		questionLedgerDeployer: '0x7e28f25ae81ac9c64e9f7c7d948da79a1e1de76fb2af2b31291d576b0ab907ef',
		questionLedgerDeploymentWorker: '0x524428b71dece827cac6568cae5aae683044ef2668e9843f626bd1631669cc71',
	},
	mainnet: {
		questionLedgerDeployer: '0x5b71198baec49219ad75c0e4cc5af022bf4b03e5d63f4d346344f55f061136f1',
		questionLedgerDeploymentWorker: '0x4150c44ce4fe0cb1c97db6c5e9647c2afd07efcb460da94a756ac2c65a6195f8',
	},
}
