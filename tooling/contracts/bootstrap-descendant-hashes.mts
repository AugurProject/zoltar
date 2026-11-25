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
	questionLedgerCreationCodeFirstChunk: '0xec6878189154d55d32a963c07897adaee5ea607eb75b0c09c1b8e838e918a340',
	questionLedgerCreationCodeSecondChunk: '0xa0d4c05863bc290b2564b118540d64b63373eeeabe625a581630a171a54837aa',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
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
		questionLedgerDeployer: '0xe2577483a81691af99554e06fa5c3ec6c1db4b2e494a1e41346fb335c99a46b4',
		questionLedgerDeploymentWorker: '0xc7b87d96ac481ce54bf4c0f3a4926e5578274d38954fe01b158aa7610744bac6',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xd028aff7289fa3df93aa3d8987d98b4c58502b7a16f7637988d5fb20856d574c',
		questionLedgerDeploymentWorker: '0xcde4ef40ee471d3cbda8b139891865bc5df450219c1c03ece94b94cd608624b2',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x9686ab52244299586b9d75dca354e82bd98f4db2fa20fa8b971aa06b63393528',
		questionLedgerDeploymentWorker: '0xf0d8766f6aeb7ea549804e01b9bcf04c841e77ff7193a1cbc7816354e53e7489',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xc46bbb41622f1e2128ae490b0167c63e93c51e58361fab7e546afbf99d6d72d1',
		questionLedgerDeploymentWorker: '0x1e7b21edf5510407bb002a27a055f36e3d4a332303c13e51ffa5071cafec8475',
	},
	deterministic: {
		questionLedgerDeployer: '0xcd300d04f3d64bee21e691f709767879c65bc03f1d712e787415c48dfaa4e933',
		questionLedgerDeploymentWorker: '0x0be9b4ce8a2675b9ef93cad34ddfc1ff8b26fb376f631de2555380ea0f85b673',
	},
	mainnet: {
		questionLedgerDeployer: '0x51bc7ee0e51156724f8b41f13a3d9e23e80c97c210ab1921ac63e9c8870354d2',
		questionLedgerDeploymentWorker: '0x87f1a3cd5994d8194c52b9cf80071bbd8b6c5852420ff4014bb272e7b6603b04',
	},
}
