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
	securityPoolCapitalRepairAuctionDelegate: '0xf73b58c41d17ab66f24514c1eed0d0794d29ed8ff5ffa44935f0e8781139585a',
	securityPoolCapitalLifecycleDelegate: '0x58f94634349d2cd771cf150d2fad03882119fc4ae520d2b7e7e5f6521debf2a7',
	escalationGameCreationCodePartOne: '0x9582a749eb98b9d3eb028db8ac19f263707d7e43854a2e0c3f865cea80c2c1cb',
	escalationGameCreationCodePartTwo: '0x2bc272d7e3961969d3bd2ddea3705232f62d8b460e90afadf678f673ef1fd61a',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xfe6341a0415e785006b64be4ea683c777d013ca878819d338c5eecec99c33358',
	securityPoolCapitalCreationCodeSecondChunk: '0xf65531d186dced791af400f58e46145a2ec744c0aa0e2371700168ffcee5ab9b',
	questionLedgerCreationCodeFirstChunk: '0xac408391e8b60ec13b97bbcf97d2ee126d828a5561f87f3abcfa87df2718509d',
	questionLedgerCreationCodeSecondChunk: '0x5bf40e8ef537f3a70310e42e81a50fbd2d4a773fb2917efb6af9a66bc6f3f1f9',
	securityPoolForkCreationCodeFirstChunk: '0x40c7cef4d199a8f27c99c52c4318a53402e1d247a698b6c658c59ff18caaf620',
	securityPoolForkCreationCodeSecondChunk: '0x32532e0b84fd8995a82f2ca35efc0ba4fb231e2880575294fcd55fa2ed945443',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x88cbb0a074ce2c4313dbb1ff1589f22eb6109403f1d96f1b605a6b503e6424f5',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x846e3f69fb6cd98cdfdfd5da16fb08a5d4f5c4eba19e5c61a210c7e4c26d3193',
		questionLedgerDeploymentWorker: '0xaab36a87a6b74e35dfd0c8d5ec69956a358fb0aad4b4d112975101780b8ef586',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x4dbbf921cccaae63a3d9276abbace8853042db4dbbdf3b4ef855b17c23b5a257',
		questionLedgerDeploymentWorker: '0xe7434682ee9b7b00d464995f4fcb7c2eca0cf77029858535ac903c271ab23938',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x7707e82a321cd7188fcd097f353c5a243d685eb30cd8da069d1c503054285e62',
		questionLedgerDeploymentWorker: '0x6aa4ce79d22e32a399a81879925d80b9e99f6d94553e8ad133b6e248644c98a5',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x44e66334ce69c751794d4088d119ec210c3e5ae13a4a5783c0f6f924576aac7d',
		questionLedgerDeploymentWorker: '0x0499ad5d2b9013af5a3eb2ffb521b9143987771014bc93a3ac323ea658e3e129',
	},
	deterministic: {
		questionLedgerDeployer: '0x02e7d518ddcaeda06342e01e09576f6e34b94e44de9a6584e6d0bd988b2c9855',
		questionLedgerDeploymentWorker: '0x5215d9a9f543c70168b38cf9de369a23ed98949b4246b15ee32dbdd1d460b824',
	},
	mainnet: {
		questionLedgerDeployer: '0x4e417bc4ca7d8c0a55a5f7fea42f0b22b7580465fab73440a949a75af61c2912',
		questionLedgerDeploymentWorker: '0xc39ed9574501ef3ff99a9bab585399c0fc1be7a450d68ca2407e9b926c1c35c8',
	},
}
