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
	securityPoolCapitalLifecycleDelegate: '0x5e4fcd2c7d6e1f49ead7e9e1e9b948a69bb2523ab33e25502d9a03e9f5c03863',
	escalationGameCreationCodePartOne: '0x9582a749eb98b9d3eb028db8ac19f263707d7e43854a2e0c3f865cea80c2c1cb',
	escalationGameCreationCodePartTwo: '0x2bc272d7e3961969d3bd2ddea3705232f62d8b460e90afadf678f673ef1fd61a',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x94a71f7a9f8c874ea08c802f9be1c9ca7f2388643814e1331835268c6d77bd8c',
	securityPoolCapitalCreationCodeSecondChunk: '0x04fcdd9768da2a470febd2328209688d8993d58ce209abbd44b5d04894329ed0',
	questionLedgerCreationCodeFirstChunk: '0x3810167fb69ac783c29a795a4d46ae8556388e7569685ce5b0a14d95e55ac74b',
	questionLedgerCreationCodeSecondChunk: '0x9de2e826f6f1b10c321e668c9425446f4075430361428dde542d522d95c600f5',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x5d788874b0a81134bd899abc78aad6371955fc5211a877481ea1aa7ad824db08',
		questionLedgerDeploymentWorker: '0x71b5f1db44ba6553a403f51c574f60e3f21732fcbc300ca65dfc76bd4d346e19',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xdf7d3213019ad26bc75990f3b101dee00f0a49265ffab41b0be42692a0ccf091',
		questionLedgerDeploymentWorker: '0x543a44ce858bcd4becb7eef87fa10bf437cebf8e1fa9848ae2e63604f078b8a6',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa0d3a85e5736ebd2c0d37852f9c6ca3fea64abcffd71c9dae43b92c4b2465c4b',
		questionLedgerDeploymentWorker: '0x4437b3ded0cc3177b80076eb16a5a9cd3a5851ee45998950eff62de1cb1bc31b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xc266cfe319738de2a0f7215417b09060a14e57f25839f719499ef242ee0ef468',
		questionLedgerDeploymentWorker: '0x80ce9cb32d1bbc7f16320780badc03684837297f113b0a30637d2bde678541ef',
	},
	deterministic: {
		questionLedgerDeployer: '0xdfe8b44a34d30fe89fb1153d2118c9a5e3c0e2ba255b03b817e7b6a30fcbc933',
		questionLedgerDeploymentWorker: '0xb9969d11aed13a6502f5c9c75b2ebccac3b1af01890d4ac08b8ad3944447672f',
	},
	mainnet: {
		questionLedgerDeployer: '0x4cac347f896dfba54161c4cf6d11464a7c324e9a06836526fbe921c1cf8a7d65',
		questionLedgerDeploymentWorker: '0xd07d19ee5c4305afdb9264430c1c8eab6b13b015a22ae07de93a758557152444',
	},
}
