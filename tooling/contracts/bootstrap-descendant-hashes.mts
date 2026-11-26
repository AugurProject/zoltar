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
	securityPoolCapitalLifecycleDelegate: '0x58c642293a0b79cc69df91cd4c54a22e5bc603c280ce97b70d8cc0e860e36501',
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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x701a682dbf0eb5144799a83d5a2ad6951fe0cced4e9f5b5e4600d7aef949c691',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x4ef086955000fab1bca48100db0c370d9aa30443398bfd77fc52fae6ca433ff2',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xd69f90f933ed86e7bf779c8bf639dfb46da0c0acd733a2f85e511c87aba571df',
		questionLedgerDeploymentWorker: '0xcaff923dd4224756241d1874df5f3a7b83de395697f00e650aa86a8c3460b8fa',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x721530426a31ee7a08d79867b34c9376b9a5b700131b7780a6490ffa57759087',
		questionLedgerDeploymentWorker: '0x9749599890f4e899307fca6ecf0e7ebf2cc03ffca288e5a37134c11d008b2bdb',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x8543effe4a42739d673be09e6286a3f85ee5d3afc0188be15cc45b90838d728c',
		questionLedgerDeploymentWorker: '0xd5cf6ea76dcddeaf220093010741c7d3d89c52abb0999d63315e5c82977c0400',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xf8d28c219e1945e15962498991adb0c28d36e00a30ddaf2fe618441cda15db4a',
		questionLedgerDeploymentWorker: '0x3206943147186677fb6bb2b6c5c01df79028ee48466edc993487e5b1c478bade',
	},
	deterministic: {
		questionLedgerDeployer: '0xcd62bbf631904fe017cd46f0aa18d6b83456f1b8d2cb517acbe28e3d3b7bd90d',
		questionLedgerDeploymentWorker: '0x495cf1aa595b8b2a4f0b8ba107e310fea7f07d1edd872469bb5e3dc127a31385',
	},
	mainnet: {
		questionLedgerDeployer: '0x35824abda32e3a199cc3e6bbddbbf9af7007e9428e05f109bb7aceb7afb31817',
		questionLedgerDeploymentWorker: '0xbf2caae382712cc81b161695bccc4e46acd3a6324dcce10d285ee851987e2bd3',
	},
}
