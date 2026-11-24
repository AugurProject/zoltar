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
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x94a71f7a9f8c874ea08c802f9be1c9ca7f2388643814e1331835268c6d77bd8c',
	securityPoolCapitalCreationCodeSecondChunk: '0x04fcdd9768da2a470febd2328209688d8993d58ce209abbd44b5d04894329ed0',
	questionLedgerCreationCodeFirstChunk: '0xcfdbbaf98314ab74ebb4ab6ec8091e067c60b73c568c75056e47be0e6933c441',
	questionLedgerCreationCodeSecondChunk: '0xb353ebf6bad46a3be037a70eb822161dc3860ef9647bc0e72885ecde73820d5e',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x5a23a1366ced1bd54880839fb063ed643c981a16af624cd0f9b7dc0e0c022354',
	securityPoolServicesCreationCodeSecondChunk: '0x290598820ca3de23b8a381d8a9e16e91fa91e6959d3028112f294647798c7224',
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
		questionLedgerDeployer: '0x3eb75f65980b9c8e94547d89e12aa534519e5bf232d5ea3e3a582828b70ec5cb',
		questionLedgerDeploymentWorker: '0xc0b60a977bbcd31d35c51c3229c930fbf538a8a408bc39a8e4c7f9e49d90505e',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x6042c16ddfd282ce0b24f222c94df885b4a36a2339ab14939069e29b98f85b7b',
		questionLedgerDeploymentWorker: '0x486faaeb4ffbb265306e577c4c7ce1c8f874ee1c3d87e43a74192c2d4663c63c',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x0eb0790608a39fceadf28b385f1f934a9fb0de42f1d8301017bf824b87053dfa',
		questionLedgerDeploymentWorker: '0xdcee6b6136c885d1820d3ab37e1abb805cda55811a6b24c2750f66a309d2199c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x38c9591dea360a46a9140a99f64ac73f7fc3b685e77e1358eb6e9a9e394a876d',
		questionLedgerDeploymentWorker: '0xc0ffa6e808451c573240cc14b180bc0a9b8644048ffe924624fa1e6b6e4092d5',
	},
	deterministic: {
		questionLedgerDeployer: '0x96aaaa4234e6cd75a3322adde7d72aa8bd18995f010eda87280b3043b4872330',
		questionLedgerDeploymentWorker: '0x12ab58d42060c78551d2957e29b7e6279464b26fd1aa967dcb4d287705d89553',
	},
	mainnet: {
		questionLedgerDeployer: '0xa0d0328e3b697f9bcba0f3cc201ad1f4c9d46598eee2dcd97610592961114d50',
		questionLedgerDeploymentWorker: '0xb88a4a48bf1ab46c70d26585b6dc558211d23b4aa8a41d013d47fb0a2be95d20',
	},
}
