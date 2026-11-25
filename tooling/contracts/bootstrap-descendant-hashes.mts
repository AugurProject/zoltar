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
	securityPoolCapitalLifecycleDelegate: '0x670a420955e30b7b745b21edb90ed479fa22573edbe2b49aa370964fafb56c0b',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x55a8cb209a7c4a590c17e393019536a4df36cd632485d42f1e39da020ca75a7e',
	securityPoolCapitalCreationCodeSecondChunk: '0xa83de7015493d51989492980bb8cc136cc4cbbf3d512d1abed156620b12072fd',
	questionLedgerCreationCodeFirstChunk: '0x4a655e474ea9ec2fe77091452b178c8c0e7ee92fa4ea2e84d2fba25d37faa5cf',
	questionLedgerCreationCodeSecondChunk: '0x52993e8566574cddc875fe80cf15c3239a0de37384119ece494a1d11c4ef9da1',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x314fd1c7e338b07b75e2ac0475ab609d5e0fb252980d51a52429e3402d2cc4df',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x9cd4054d759d2030485c41fa2c71c84d8d2edf60b500ef98abad888015d378a2',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x09049d0e2260218db30fef395fe0fe2e1087638be7687c41bfeaf5851f17bd6a',
		questionLedgerDeploymentWorker: '0x68134876091db2dc0a317cc9f133d35242809d38dc9f8ac33d195b4853104223',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x1d950f6d1884998e8134709b4ac406cf2033efebea6cf1000461aa1279799b57',
		questionLedgerDeploymentWorker: '0x8ca51262edffde9f1d4f3e58a375ad7b5450a1555ed5897c6a6f858a8942a019',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xf4e7b267dcdadacebfdad1f076339dbdd1f3433b8309d433bd8c9ba7ee51af10',
		questionLedgerDeploymentWorker: '0x793b25bd27e85cd3ccab95ca8c0e466a10eab3a0f4a18c92e66d2d82e7030cb4',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x45a52db9a4c7c3374e0a0b67c16e13934398ff44b24d2843ca9b390e0f291fc7',
		questionLedgerDeploymentWorker: '0x6105837a2db67f506c552c36363dab50b4ed91f44226503da8a3790e97c69164',
	},
	deterministic: {
		questionLedgerDeployer: '0x6b1b32537675f46e5ff16e722708fa488b09c72d8185d2cf1aac88cf807fd4fa',
		questionLedgerDeploymentWorker: '0x46329096e9eb5ff3afbe098a2551d5cf2b7cae534ea3f63517fa87e448ca07fb',
	},
	mainnet: {
		questionLedgerDeployer: '0xe3361b7a19153cf244cb63cc1661779cbdf7ce5939bd1097cdc3080f77932334',
		questionLedgerDeploymentWorker: '0x432ed1c4310c6d4b1e169180594dabc350ed3c8519d7acade75103f60adf8f78',
	},
}
