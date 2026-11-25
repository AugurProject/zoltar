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
	securityPoolSettlementBookCreationCodeFirstChunk: '0x67106254a607303f19b1a51c3d74041443cc160a584e86e6dc9f73cbd93a70f1',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x3676c5df31144ca74abec786f915421fa90d622dd04232d0fb097392674f7188',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x314fd1c7e338b07b75e2ac0475ab609d5e0fb252980d51a52429e3402d2cc4df',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x9cd4054d759d2030485c41fa2c71c84d8d2edf60b500ef98abad888015d378a2',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb544186a8c8f7244d63b8dc5564884213b0e4e73cf3c97eca01ea21ccc08b3e5',
		questionLedgerDeploymentWorker: '0xc67ecf6d8d75aa75eca07b9b750d6e3a50d86bb5a4f29fac33830c13ca1c7a9a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x15c07b2603e9a5b5f2577579c9ee52433fce5fde9a6bb2a811c1a13416fa016b',
		questionLedgerDeploymentWorker: '0xacc5f23e6ca4349cacd9d4f8852955f70b0900dda9e00a657e01aa87eafd8753',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x90096fabc787f68b609a94a38f26eb44583744b55b51b962b594e22e25a1dccb',
		questionLedgerDeploymentWorker: '0xb6371e7cba05164c8d0eaf0693b03d36b270422168b12186d51d12a52390fc0b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xa8b52458031497d8d4be8d77cc7276d10a33f1991e0d093d1d590766fb00367a',
		questionLedgerDeploymentWorker: '0x66939380f148105fac2ba504613142ad6333fe957ff62708c9322258dde66508',
	},
	deterministic: {
		questionLedgerDeployer: '0xf73acc5733310f73465fbb2922d4e6db5ff5c66085d06a17a8a7389784c880c0',
		questionLedgerDeploymentWorker: '0x500433a65dccf238fd759a58fc348965a1d763e371db136a1040ec30f73e7ce3',
	},
	mainnet: {
		questionLedgerDeployer: '0x0366ffe72acf14c97823ded062bb7e4a95428ac5d9f52128a76b31772dc63716',
		questionLedgerDeploymentWorker: '0x6ecb3420db1c926b33a5164315c658989cadfcadaeae626b657a69cc5c1dc41e',
	},
}
