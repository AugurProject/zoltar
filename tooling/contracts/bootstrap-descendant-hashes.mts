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
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x55a8cb209a7c4a590c17e393019536a4df36cd632485d42f1e39da020ca75a7e',
	securityPoolCapitalCreationCodeSecondChunk: '0xa83de7015493d51989492980bb8cc136cc4cbbf3d512d1abed156620b12072fd',
	questionLedgerCreationCodeFirstChunk: '0x020cb7d2ceeaee9cf6e4b035544d10c8167b90e2d6c6b27172b3f00df2f61934',
	questionLedgerCreationCodeSecondChunk: '0x5c8fd26f41416b2ab8bae4fcc3ba48ba60148c78a3beff9a5c0b50a553f0d04c',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x3238eeb98c3c786fcbe0a625246223ba57922e8a0b2cff13e0427870d2721ec5',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2b32c20bdeffd2dfb8fed2a0851e653ff99593814d857895069357be20f183f5',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x724b77c9615f0ea823d89f727b9d6a62404940197561b42fd11c42ec3d5d9129',
		questionLedgerDeploymentWorker: '0xca12e13798c69c2d68a776af5a02a8b6837d9a4a361c40645a22da18498689b3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x282bf8ff580adf6f0b859b9ad48e5aa15e465589bb5c428d7ed91444aa8dd465',
		questionLedgerDeploymentWorker: '0x03ddf6e982c1d42bd762a35b33ba42f30d81be581a4de6e6bafb395c65fb2989',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x05538798975c80280a9b790bc361d495d89d969452165b2e454d5f5a2d15b41e',
		questionLedgerDeploymentWorker: '0x5d38fea0c03b75fab1cff9fc29798df5aeee89f4697433d977fae881d2cac772',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xa4cf8d1fb8d6db2a1a9f88e423fa5bb8395f3c8e0f067ce3a5c7a33ea1219b11',
		questionLedgerDeploymentWorker: '0xed1a8005bf212770cf1bfc18554f2dc44b48ae57f378c321511eec0689a9a521',
	},
	deterministic: {
		questionLedgerDeployer: '0xc2cd59f2655e77738dad6ee2ecd4a8bb4cf4bb0ae358ab53afa20f2eaaefcff9',
		questionLedgerDeploymentWorker: '0xf26249548698ddb0b21647b48165f84c063310473a427c95022d9e71b3f5f38d',
	},
	mainnet: {
		questionLedgerDeployer: '0x0d0ea17b6217d32be551d1b9d9fe03c4545961d68b71fb070aa53ffd059f69ab',
		questionLedgerDeploymentWorker: '0x9b3ce29a5ea863c711eb1ac614ef82756f85b2093d42cb1f45d93da8a63b3bc1',
	},
}
