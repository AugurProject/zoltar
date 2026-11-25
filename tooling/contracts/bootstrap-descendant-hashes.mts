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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x4b8838ae53c9f5fa6a0e42f723a9014057703e077876679244973f69d36361e4',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x7e75c561ed926ecef1f0e74f39f2a1cbf8d8ab0206682154693dcfe99884e72d',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x800bc2ff7d89d0ec80084df4a2b94ef17953d2b8283fb3b0fdee5d86cdfc1362',
		questionLedgerDeploymentWorker: '0xba0a3bfe84e906fef531dcf5e0c9569491f49b4b29811e655feba0d89b10b6f9',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xbb90dfdd0272c0345a1eabbf194440f6460e3f482558bb313f47a1457c05968c',
		questionLedgerDeploymentWorker: '0xce5444bbffc4d1a60ed8bd994e5e188548bd72a9e26f6bf698eab2d8eb821fa2',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa011d44c856d254a9dd5fbe7f992a46a8a7d1b4162b9f4510b9dc29321672932',
		questionLedgerDeploymentWorker: '0xfac8bd38f33dd8293428e26cb393f3308c24b2a6fca62a68bd6744ac7d99e7fb',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xadc1c4e5b826dcba31f0a4cb57e350849d428162d6a3f023e0423fd49b9c5a85',
		questionLedgerDeploymentWorker: '0x091e49837389329b45aa0203d6adb8498518f528709d89ed6837005cbfe087fc',
	},
	deterministic: {
		questionLedgerDeployer: '0xfb009dbb2dea3d884868386767ea6179321c7883e141a893bf8d3f5f0b991922',
		questionLedgerDeploymentWorker: '0x0b07a6ad7129034d22f93ac9535fec3413482d256a1ee185d46477625130de6c',
	},
	mainnet: {
		questionLedgerDeployer: '0xc39a0dc05d02b6547936756feef00d324858605f3291500a3d62c416513710ed',
		questionLedgerDeploymentWorker: '0x5c0c517d3d904889c743e6217abcc202c09915a2c68b42092d0212529dc3ae5f',
	},
}
