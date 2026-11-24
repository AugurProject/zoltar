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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x872f19ab2eebfbc407c759c09d3db1a5dcda8d317c1192d5f5893ba845624c81',
		questionLedgerDeploymentWorker: '0xb1bc7e57120da0ec712d127adf69a9fe268d3f735372b95ade4138b033694206',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x7236113d7b73af43107ca1a74067e0b94f527d592613b7e570083e76a666b0d1',
		questionLedgerDeploymentWorker: '0x8637de30d3736bf68877c65df671071cc2a4331017c660098420b0ff791b45b0',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x2e8f07a45b2bf15e5200af4661390a2e8ecbe79d3db987bb17c3d977dbe09d7d',
		questionLedgerDeploymentWorker: '0x8d0ee288801b823693a28abaa3d3cf2622be2cd24f6ec1fb2f11394fb8dfd4f9',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xc1544332a37e5288a3fdd060280c8800b54c6f07d236dd4f90ac79b1f6866bb2',
		questionLedgerDeploymentWorker: '0xe81652e7d6cf3e3ff49d91dc84b18053320a8daa81699e3c59138dd012b6a35d',
	},
	deterministic: {
		questionLedgerDeployer: '0x4c3f8d6e3cc9eade279a4ccc0ab741ed5458624fe53ec8f51482c980584e97ce',
		questionLedgerDeploymentWorker: '0x2a85d15e4c450703f14dcdf4170d84b1ef363f5bf16c574e5021bf6da0160c97',
	},
	mainnet: {
		questionLedgerDeployer: '0x9c75e9073c41f0aac79f9d69fa402061a257cc44867e5f0a2dcc7fbac5fd5c91',
		questionLedgerDeploymentWorker: '0xc583764126afcf915cb9648637497f5b5c21c3a5a682995b9a337cb4b1b290e1',
	},
}
