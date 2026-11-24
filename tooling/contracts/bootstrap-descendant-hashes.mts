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
		questionLedgerDeployer: '0xd4410eb7810bc617d4b5568c478bb2033f367959e194bc56c7cbcf4ea1cffa69',
		questionLedgerDeploymentWorker: '0xc896786098b8d476bfc7ab6be482c6b3eae522453eb6af8a5a8b84d8507191c2',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xac66ac851279febf40da3c086fc2489f734d5c0695f2770dea830798391107bb',
		questionLedgerDeploymentWorker: '0xb0d20edb17fbf0e4f3820e7a9f08a532b17bd4fb7540e9feb7f865631054ad24',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x0bf61e3febc4690c25c53bbd70660074364f290bb0d83e75e606a564964c59b1',
		questionLedgerDeploymentWorker: '0x2775557d36d5e938ce94ada337a893b476283d4e5fa742438647923754dd34b6',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xa368141659e4b1d959654bf116e424f14c48592bbb13bff93b424a7c81e0a4e9',
		questionLedgerDeploymentWorker: '0x4021faa8393e7ec2a54018004d95afdc34f66ecf7a4c4fdf6cc38c100ce14bfe',
	},
	deterministic: {
		questionLedgerDeployer: '0x0292ea3d00cd5d7257126bbcfb439f2e1705792edfd82cfebf07dd56a1d55a59',
		questionLedgerDeploymentWorker: '0x79bf082f9456cb94c7e52d2b02c65d75fd39c7704de052cdaed58cd9859d1d05',
	},
	mainnet: {
		questionLedgerDeployer: '0x933340a525e8b1e6945355e9293ff226a0e844e0c0632ab115f718604fd7513e',
		questionLedgerDeploymentWorker: '0x78e2bd48d703875beb2b536732fb4a7cd690a58efc40d2780dbe035a49729230',
	},
}
