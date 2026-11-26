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
	questionLedgerCreationCodeFirstChunk: '0xec6878189154d55d32a963c07897adaee5ea607eb75b0c09c1b8e838e918a340',
	questionLedgerCreationCodeSecondChunk: '0xa0d4c05863bc290b2564b118540d64b63373eeeabe625a581630a171a54837aa',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x701a682dbf0eb5144799a83d5a2ad6951fe0cced4e9f5b5e4600d7aef949c691',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x4ef086955000fab1bca48100db0c370d9aa30443398bfd77fc52fae6ca433ff2',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x81390d2a756938ea1e1a3c052419929a0b8346f806e96977f4dd8f3e5e936e3b',
		questionLedgerDeploymentWorker: '0x58a6491c4f93c161c5f99ab9456080ee59ae8d15a1e20c25ef9914e2c4349838',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x6a599284ed1da40b4ff7de7c739c5ce591e75d9f22a1dcc877337006bada67ce',
		questionLedgerDeploymentWorker: '0x8db01c34347413a6ebdeba01ad2507d81e0fca17c97bb38f56b6ebab5b387582',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xfbbb8313525f01eeef49ae92203df3579a81b0e619afc42ae631d34234e2cce7',
		questionLedgerDeploymentWorker: '0xe7a2d398f49c15db3ee1584be9bd9f3db557a1f6e4193e53f5e35b9f70f1d08c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xd9ad4ee5c881c6ab056e5424e44850ed5c5bd18aa60ab5fb21e8dc898a1725bf',
		questionLedgerDeploymentWorker: '0xd047441420f84d381260cd6a30a6c788f988044ce6730f525f26145cf1111742',
	},
	deterministic: {
		questionLedgerDeployer: '0x4799fe026d42b257a5be3c3253172247e5c651a612770fa6b4a1e44fc391db47',
		questionLedgerDeploymentWorker: '0xcecfa1af09817cc9de050f2d88c70bfbd403fc9db5cf7dd55ef4e1e106dc7e64',
	},
	mainnet: {
		questionLedgerDeployer: '0x41ec9e9056366f2bf243372cbe735154f192fac513ab9c92db77bc1c5bce67fc',
		questionLedgerDeploymentWorker: '0x0b3728e9c0de5760541c0a5c63b6103f9724c9b6bdf9d7207444fbe8ba9b2474',
	},
}
