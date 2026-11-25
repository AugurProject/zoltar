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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b8838ae53c9f5fa6a0e42f723a9014057703e077876679244973f69d36361e4',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x7e75c561ed926ecef1f0e74f39f2a1cbf8d8ab0206682154693dcfe99884e72d',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x9fd7db6d48cac2e66ab6cf7c7042095057233bc0c278875f7bf83c557961580a',
		questionLedgerDeploymentWorker: '0x0e5f6cad6d5e0f9af0eceddfe12156873e9f60b12a1b769a50b4f5fe6ea1ef19',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x33d44852a5e43b5e9c08c7513ebcfb029e6ebd66dde4b1a670ede67b167270c4',
		questionLedgerDeploymentWorker: '0x94ddc17da1d9be86321f3d8d94462dbcd75b0d0e42f46f9727dd09147991356f',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xdb302fabdefb077dcc9ae466b4cdcf9c8e672affff896972c37812cceb732d9b',
		questionLedgerDeploymentWorker: '0x77945a916855e6cb8bfea829d7ddae8712aa8e28b706d36a2b34d3794b70bdd4',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x76b65a6cf01247cd90630e7a678107c4b99e5951a1b9908c25592ce0648a46bc',
		questionLedgerDeploymentWorker: '0x163e226f45b326a786ede93c29fc8340115a64b067b531b510e3d25ac8858c96',
	},
	deterministic: {
		questionLedgerDeployer: '0x09ca48d2ad2de81b948fdd2bc4b30c6cdc33467504900809c76271fdadd3945f',
		questionLedgerDeploymentWorker: '0x2ff0a6b26acecec17f47087d0cf82eca09e6a28e1e674d359d7b464ad2325cd9',
	},
	mainnet: {
		questionLedgerDeployer: '0x8b0788985ec436ddd0f794cd13e218fe285fd5136b869a660c33cc4c5f4d4fb9',
		questionLedgerDeploymentWorker: '0x5e88c83ed638447ca261e404c40eaaf9de18424dddf6a1f71e1fcbe144ad0999',
	},
}
