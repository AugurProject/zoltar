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
	questionLedgerCreationCodeFirstChunk: '0x3810167fb69ac783c29a795a4d46ae8556388e7569685ce5b0a14d95e55ac74b',
	questionLedgerCreationCodeSecondChunk: '0x9de2e826f6f1b10c321e668c9425446f4075430361428dde542d522d95c600f5',
	securityPoolForkCreationCodeFirstChunk: '0x40c7cef4d199a8f27c99c52c4318a53402e1d247a698b6c658c59ff18caaf620',
	securityPoolForkCreationCodeSecondChunk: '0x32532e0b84fd8995a82f2ca35efc0ba4fb231e2880575294fcd55fa2ed945443',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x88cbb0a074ce2c4313dbb1ff1589f22eb6109403f1d96f1b605a6b503e6424f5',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x68b766190133fd755ce7096cda4fca04dce57e4d659ce8cb102afbedac6b4688',
		questionLedgerDeploymentWorker: '0x2971b1a645a34fa1bba668ec114d2c74b731fe0fb688eef3e049c67da7b49178',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x5c2237dacaf18951fb0c125f820a4463f1746e58adfac161702f8b6a38116ded',
		questionLedgerDeploymentWorker: '0xea2497720d0d318e72312f9d3cf6345eab21dd17f6d8a3c9c4443bffa566cfb3',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x71c963aa90021d872e0f7ed27d35aa3136b66b73df8ed9397a1b11fe8f134466',
		questionLedgerDeploymentWorker: '0xbcb8ff1bc94734b46d0928a1bd1ff7fd5ece757457a66e0a115bd825f8291481',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x354e4e2b6d74aab399444f81fe2a06311cc2ba0bf77115ff7a227728a83dcd90',
		questionLedgerDeploymentWorker: '0x0c08ba577275072fa5eaf6a6bb20ad59665bee9827fac144201015abd01ea9e0',
	},
	deterministic: {
		questionLedgerDeployer: '0x69e300c03e6e432b47e0f043cbceb83a3683492f014471a3d8f9f7841deff355',
		questionLedgerDeploymentWorker: '0x202d156e4b4d1de9eef2f345a104543e10632164d650669afca58f4135899299',
	},
	mainnet: {
		questionLedgerDeployer: '0x63a39e6c2b422c796eb316129c6ffb67ce1126d695f48f723bd030db1cc6289e',
		questionLedgerDeploymentWorker: '0xa47b68dff5b5456403cc4ec7828bfe998da8fcfba92523c385cd914783e97bc8',
	},
}
