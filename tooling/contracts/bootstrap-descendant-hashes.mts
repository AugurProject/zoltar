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
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x94a71f7a9f8c874ea08c802f9be1c9ca7f2388643814e1331835268c6d77bd8c',
	securityPoolCapitalCreationCodeSecondChunk: '0x04fcdd9768da2a470febd2328209688d8993d58ce209abbd44b5d04894329ed0',
	questionLedgerCreationCodeFirstChunk: '0x4a655e474ea9ec2fe77091452b178c8c0e7ee92fa4ea2e84d2fba25d37faa5cf',
	questionLedgerCreationCodeSecondChunk: '0x52993e8566574cddc875fe80cf15c3239a0de37384119ece494a1d11c4ef9da1',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x5a23a1366ced1bd54880839fb063ed643c981a16af624cd0f9b7dc0e0c022354',
	securityPoolServicesCreationCodeSecondChunk: '0x290598820ca3de23b8a381d8a9e16e91fa91e6959d3028112f294647798c7224',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b8838ae53c9f5fa6a0e42f723a9014057703e077876679244973f69d36361e4',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x7e75c561ed926ecef1f0e74f39f2a1cbf8d8ab0206682154693dcfe99884e72d',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x18e6de1b974dff26b7fcae131fad22714e90f2d12d9867a3bb2beed0985cf91c',
		questionLedgerDeploymentWorker: '0xe3b0118d0a56e5ec84258a9373767f314507ff730cc5ec9afcfe26af538164ea',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb73eab776a7ba3b8431976b0f2604a866f7e231e7dec815428bbd47a1e1abf8e',
		questionLedgerDeploymentWorker: '0x11ae33724425def26bbc28d00ce0e8809b8e670ab1167d1b7b7546789a264fc3',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x858e46cae8b7e30a74b45ef06a0d24754c9129b532f0b1902ff45a6b9ed93b13',
		questionLedgerDeploymentWorker: '0xc3d60194027da78f55f7561803709b14303efaa31b4f255397ee39960e8573b2',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x6831f73664a80fabae4f019661a36853deaed2155eb0ee5f209e7ef33da99ff4',
		questionLedgerDeploymentWorker: '0x467a39d94adb015bd075378939156cf22224a7e7b24c973d381641701e789344',
	},
	deterministic: {
		questionLedgerDeployer: '0xadad344ec48f45aab22c14748a8064310ac189b661cd68d7a2939c2328af0214',
		questionLedgerDeploymentWorker: '0xca4eb4420ebe23a998a976c4156a6b26f0add1b21105cb43ad6de62db3c70d32',
	},
	mainnet: {
		questionLedgerDeployer: '0xe1f5f583257900d82e2778c28528af39abea5757f07542399aaedf68560fb659',
		questionLedgerDeploymentWorker: '0x2d9bdffbdcf6d28772d3f38eca29a4e93e27c8e8f7d09208c0024f8a7a2e56b5',
	},
}
