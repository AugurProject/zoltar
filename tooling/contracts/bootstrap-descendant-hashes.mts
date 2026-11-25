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
	questionLedgerCreationCodeFirstChunk: '0xcfdbbaf98314ab74ebb4ab6ec8091e067c60b73c568c75056e47be0e6933c441',
	questionLedgerCreationCodeSecondChunk: '0xb353ebf6bad46a3be037a70eb822161dc3860ef9647bc0e72885ecde73820d5e',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xf9711adcbb5d53b71c60ac95c54b9fc6f9e6351d8644d85fb02fe422818b4873',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2e08b244ebc300d712bdc3403f7632a5d371b21ff02302a9c7a028c7b758e0fc',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x260b97d5a42542423d6b79e40ab38dfcc03e3b8c8ed2676fb07ac17d15437658',
		questionLedgerDeploymentWorker: '0x7d0e01dbb9ad08d0e3372764d37d6e3b90c938ff22a2b3d981a826217b92e593',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x96da33a24563729d4443f1799032c9abd1704d0ee166fbf3bc1ebde06e9ccaa5',
		questionLedgerDeploymentWorker: '0xbe516035f7d15700c25f086d2c8d16209056ca0d5f904bcdc39b8f7898b2e8a6',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x6d8f4478ec17f1825276139fa4ec2b79ebb3f489de32e1ae25bf69d0a700bc8a',
		questionLedgerDeploymentWorker: '0x29facc1f996bb63f515e7319ff98474ab9196509469c601ef1a0183c98e793b0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x5dce7134028d78f84390de7e6076acd43e36c06f32d66aae653aedad9d0e2f0b',
		questionLedgerDeploymentWorker: '0xa8bbe52b379c1c28ff5a6acfe58e7fcc00dc2d31095e7a30528c55f7692df5e7',
	},
	deterministic: {
		questionLedgerDeployer: '0x3d77ec649f2774b3e36287705ecd59e742e3cf88f5f08eda13b6ebf35cace13a',
		questionLedgerDeploymentWorker: '0x63a0e30a3f290cfa8502a6fb03a9812fdd4aff94b380c8deae8b1cae0f2caa9c',
	},
	mainnet: {
		questionLedgerDeployer: '0xaadab18b10ef5e91693bf4e4f434f35add7156a55e6a2ec632838966af659540',
		questionLedgerDeploymentWorker: '0x4f7214ea6d8518d93bfc6547ab3821840b84dc54d58939c8518bcfd87ba0389a',
	},
}
