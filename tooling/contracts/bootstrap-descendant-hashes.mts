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
	securityPoolCapitalLifecycleDelegate: '0xd522b87cb86a1012deba3fc1678f4ffa4c461605af9b7fd093da169c2eff5828',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x55a8cb209a7c4a590c17e393019536a4df36cd632485d42f1e39da020ca75a7e',
	securityPoolCapitalCreationCodeSecondChunk: '0xa83de7015493d51989492980bb8cc136cc4cbbf3d512d1abed156620b12072fd',
	questionLedgerCreationCodeFirstChunk: '0x7d4148fa5b5a920afa1f5dedd92aaa3e27e39684ae881a9a954f4e0ad406c45d',
	questionLedgerCreationCodeSecondChunk: '0x81376c6efced84a998040f7399211f84f20b2db0040f3b4e80b53442fa7ec9b5',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xf9711adcbb5d53b71c60ac95c54b9fc6f9e6351d8644d85fb02fe422818b4873',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2e08b244ebc300d712bdc3403f7632a5d371b21ff02302a9c7a028c7b758e0fc',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x0be38714eb7ac43e34eaf14f6fe7125a091c93ee6141cc05c99a1dce57ce2840',
		questionLedgerDeploymentWorker: '0xa6b0b8aa7bfbc205633963fd710e5809c2d80c5dae7b4d76c2ae8fd7ab9f2149',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x91b5a25e898018e3d11b97201ee30be9e8ccc3aad0776ee957680ac68bc4f7d1',
		questionLedgerDeploymentWorker: '0x828ed9f2ab462e847a060311824047d4d868253c18539bd183228225c3326653',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xae46cc9c0abaaf453cb7b262ea3d9793be9caeb0493edc34804266e9dda71df6',
		questionLedgerDeploymentWorker: '0xf180faa9c12fea7622a90724c6117d4789138a36108084c27b2031d183de5669',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x57ce95de1697e3d7608808d32f87832eaa065cf35afd38d54134f1c01dd0b664',
		questionLedgerDeploymentWorker: '0xf8966bf7f42a29c241638a99dd6f2c2b76b4c0b230a44ab80c8f2b1f77803975',
	},
	deterministic: {
		questionLedgerDeployer: '0x85951d76a622a866abe7c7b9960c00c11b7b48c96ddc02b76e4ab7fd62831e75',
		questionLedgerDeploymentWorker: '0xe56163fbe6373f8e856c372409fa24c9260dd7f890cba9fa05f4c053ef16b1e5',
	},
	mainnet: {
		questionLedgerDeployer: '0x3f2363372a9d1ebdb9c65fad2639cdae0fc16915f4bd66da3175cbf0a67be1d8',
		questionLedgerDeploymentWorker: '0x7fb6a5bd9e2256926a730bf2323098b33e8ed4795f11aa700e8d7b0436cd5d60',
	},
}
