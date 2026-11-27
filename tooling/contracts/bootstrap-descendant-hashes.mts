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
	securityPoolCapitalRepairAuctionDelegate: '0xd2e71b937dc76627276b68b541b0534412ca848f77e68e024f5956afc1b9a7dd',
	securityPoolCapitalLifecycleDelegate: '0xa237543d213e37779eac76cd2b788e04a96d5ec15df4079fc5c0cfba5c2ad459',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x2dce59a3c45ad38191a8b8649585cfd61e371312c1a1ef86f75df956a1b0c3dc',
	securityPoolAuctionCreationCodeSecondChunk: '0x8d4b67cbf9d29c91dbd9932d2e2c5fb93b740d2a9a833584ad52e302c807feb5',
	securityPoolCapitalCreationCodeFirstChunk: '0x187c727d5254fd009b234c876d636d5fa9624a3132cb48bc0b41fb28f127d06a',
	securityPoolCapitalCreationCodeSecondChunk: '0x070a3f9f1deb8e4af4720ace4e1406d7fb6da644d631a5604d1b28f0b53f7a3b',
	questionLedgerCreationCodeFirstChunk: '0x4a655e474ea9ec2fe77091452b178c8c0e7ee92fa4ea2e84d2fba25d37faa5cf',
	questionLedgerCreationCodeSecondChunk: '0x52993e8566574cddc875fe80cf15c3239a0de37384119ece494a1d11c4ef9da1',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x701a682dbf0eb5144799a83d5a2ad6951fe0cced4e9f5b5e4600d7aef949c691',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xcf621c6bdc2538beea0e989c69b558b40805f7f9e1a308cef55cfea31c2bbf6e',
	securityPoolCapitalFeeStreamsImplementation: '0x78a6f7b63a133afb25bdab77df650d341e97220ed739e3cba0313de30aa5d909',
	securityPoolCommitmentIndexImplementation: '0xf6833bb3f36f8274fd127547d14b733fd9ae89679414d113f6f28ad30ae5c299',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x21810bc55f723678f1e0a121db2b97c867e0cc4e42f82f66e6a43d4fdca37a8c',
		questionLedgerDeploymentWorker: '0xe2dec7d8e17655f15becdf7e4124fac3262d0e0e17b919893623cf9bde2a5e9d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x8ed1ea6c26d3e1eb5ca116a3b600490ac921d3627f8da1e0eec09ffeec0f3887',
		questionLedgerDeploymentWorker: '0xd55db5e67816d062c5b66ce6251da6320d2bdffbbdcc13ceb9cf20446bf813c8',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x019275a8c5dfdc8f896df984392f1cab99913323605f575b141c29c691d752c8',
		questionLedgerDeploymentWorker: '0x4ca6cc12483c8f5ad6e5f429508a24768ad69ea9de1e505d3b22a3bfb1d4b90c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x528baa6cdcab7badf9a6d4752dcfe17825c103a54219fbd6f2c80327ec683cf7',
		questionLedgerDeploymentWorker: '0xd085874e2e1e3948e18ae6c0e06a221aea9ef5ff06c8d8bd4dad3716ee18c868',
	},
	deterministic: {
		questionLedgerDeployer: '0xc74bf5f42a5f2cf133d48a820f56a40d710e42bd0196950ada1f882dc82b80f8',
		questionLedgerDeploymentWorker: '0xaaf382d014b3d18ec1aab4b334f5faa2f652ab3edbd1127b59989839a833d745',
	},
	mainnet: {
		questionLedgerDeployer: '0xd8fedca2e15a3a5ee13d09c5b615b3da9c6ea6edf0527e2b15e4904fb6bfed59',
		questionLedgerDeploymentWorker: '0x2859e94ba6ffb88cbf54265380b25fbd8e3983cb0ef4ca25bf30f149527b9f4a',
	},
}
