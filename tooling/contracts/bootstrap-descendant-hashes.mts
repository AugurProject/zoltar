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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b8838ae53c9f5fa6a0e42f723a9014057703e077876679244973f69d36361e4',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x7e75c561ed926ecef1f0e74f39f2a1cbf8d8ab0206682154693dcfe99884e72d',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x75e030786601112372775e8454abb1c213fed3772f224d73b4d48290ba882bee',
		questionLedgerDeploymentWorker: '0xcd7435f6c405c276ec90f3839cd09a20b43d08bbb950a1633dc5f611aaab0945',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xaa54b396d12f26ddf635645f007e5c476f2664a363abdf090db0d6a240768b97',
		questionLedgerDeploymentWorker: '0xa69df2350e47f88d0ba19f6bd67e15d721d88e34bafdb18850131ab04870f5fc',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xc41867221c079edcd215faaa9de1f438d77f40e32dfed1aab658d0033eeeb801',
		questionLedgerDeploymentWorker: '0xe7a7eae1132367052b9b231b9437fdb7c123c437c17707f8c688e906cbd8bf35',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xc7c99cac61f805a02e6b810f395586a1eba36c705959d1a767818432d01a1ad6',
		questionLedgerDeploymentWorker: '0x9db9c4f168523b77e203e29bdf1fb5bc59416e14136159fcf654c91879634f43',
	},
	deterministic: {
		questionLedgerDeployer: '0xd8b1e1901778e7fe5539ef1568a9315820b3638dc06b9ff1d1b9609e2e63c6d1',
		questionLedgerDeploymentWorker: '0x88ea79e436701d5ab5638a1a0ff90817b573fda1e83569451ce6980371673c51',
	},
	mainnet: {
		questionLedgerDeployer: '0xd91eecdc39fd02f1ff7ed2b0070064d61a8d2af83219fc0c95c8bbe2f25af789',
		questionLedgerDeploymentWorker: '0xd9dbb933adb0959fb6395f8d607373f11fcab2edd3c727cc27769b17444ea394',
	},
}
