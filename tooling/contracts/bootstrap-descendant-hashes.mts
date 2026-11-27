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
	securityPoolCapitalLifecycleDelegate: '0x202879d948bb7005c3c3fa392a83617ecbeb4e0382addc68070636f08595740c',
	escalationGameCreationCodePartOne: '0x6c8b44be45827ab7f0b553848fd36fb9840f642d77ada716fbe1294c6e3bd587',
	escalationGameCreationCodePartTwo: '0x572a87ed56c577a57692ca951475256825262e35852edb0135a62cf84cf7d34e',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x1a9c96f9477b0590b5078eaac3090b7619dfdff3dd03be206c882a67bcae3b23',
	securityPoolAuctionCreationCodeSecondChunk: '0x241af305ddc3bbbe36f07223b2eb67968885dc95861d0bd28c07079e474da0cc',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x749b7fd03149280faf4182c1d9da4471dfbf1cc985fd0e558449db6560224683',
	securityPoolCapitalCreationCodeSecondChunk: '0x7ebb7166c6a27e881a6ea2e070d16c21131ddacb847026a1a0b795d45c37194d',
	questionLedgerCreationCodeFirstChunk: '0x691f11c60c59a18ebbbb3fcf5d5de304c0603d9e14aa8c33d59fa001f3a86e65',
	questionLedgerCreationCodeSecondChunk: '0xedfaf6d8c1139038d5e30bf2b9e09172187d6c681f5163f1ed83f872bb8e3a7f',
	securityPoolForkCreationCodeFirstChunk: '0x8c405312859e853d47476fc83f6377bc57d36bfe4d2ad29cde5a3e76dd796516',
	securityPoolForkCreationCodeSecondChunk: '0x077cd869189e8a76467100670caef018beca1d76d3af9e2fd9394a9b0ef11ad4',
	securityPoolServicesCreationCodeFirstChunk: '0x368d8c4054e7feca57217b3c649fdb28cc812ce77aeaea2d2499aa49511730aa',
	securityPoolServicesCreationCodeSecondChunk: '0xe24966ab834ecf51f0afd176bfd371130f9a7a424ae8d225c67dde4f9d1307f3',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x99468618873223fdb2b76ad1cf81b8c39c610d0593d0962fd5c848654ef6b46f',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x1342de21be3ffe97d7956d1ed0c80d1eceabd7093808016720be5c6e28192fe4',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x298c9277a921244626cff3adf6803b8e5fff7b90811af8cbf9ed295eab7d3820',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa6a73a724f965075a412fd34a5b7ccd57368318d65c2f86fbd4311293a4ea393',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x44b790cb243757a04c8affb70c1b8c6edea3f5a5aef4b62a6be0363379d4facd',
		questionLedgerDeploymentWorker: '0x8b63d84aa221ecd9fe8eda0a46c78a0f6e9d09d6aa3501671f604fd23d0cc9ca',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x74bafe03c1feeaec20e7f74c136fb261d3b20095c83aa1a4dcb0666b750ff15a',
		questionLedgerDeploymentWorker: '0x78ea8101d52b0fac6b88b3b888a2bd330d892c154f8b7d326ab81b7363abbd1b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa83a5854ae2fe512bb440c092d1a7e2c106598bff4f329c6772b210f12e10afb',
		questionLedgerDeploymentWorker: '0xf70ddf22fdbdf7abdbf350b0fcb958cb859c9b54d1eccf67d58845bf1803a4db',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x7de52c8b787e50b7898132fe44dcc7d80ec65e74316c53bc409063102d93728b',
		questionLedgerDeploymentWorker: '0x5db23598c7cae93ff3c163b7eac726bb6ffc8d2250198f6cf862aa7063bd1dc5',
	},
	deterministic: {
		questionLedgerDeployer: '0x53123a9414e3d83277b1264c07d55bd7fb5ce58e47ce924f41aa0f6c1e4ad8a9',
		questionLedgerDeploymentWorker: '0x948dc795876bd32a7fa4687ae59ba06f7a7572979ab4b68830f7e3040ef05afe',
	},
	mainnet: {
		questionLedgerDeployer: '0x82b711d705dc5814f7d1f72162c3d1b4d19e5021d01472d06c2ff6dd817a25cd',
		questionLedgerDeploymentWorker: '0xacafc2770aa6229af832955d73f059574b5a3d2d9dec8aec59e800908d48c7cc',
	},
}
