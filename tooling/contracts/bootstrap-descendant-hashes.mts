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
	securityPoolForkCreationCodeFirstChunk: '0xfd327bdf09d209ac5eaa91bec5a75e33fe321e149bf2b8779bc83af68f782523',
	securityPoolForkCreationCodeSecondChunk: '0x6be4244e9dabd19f7a8723cd88c9919f72cd8b4ced007674c0595affd63405d1',
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
		questionLedgerDeployer: '0x0ad90c0b3068bc0c2a3505951f2f2f053b0557e481b804d06f1d02faf545f666',
		questionLedgerDeploymentWorker: '0xa1fc6fdba7d28ff5ea82fd1a01dd9ea4ff3489e2310559971d77113cad1bbdae',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb4017f657c3703c0f83610c32396e55698bf3e6b4bdaea14a210a3c4c1e5bdcc',
		questionLedgerDeploymentWorker: '0xd103ead333c8519f36367609474d2633104eea6ecb47b0779c5ae71cb5770524',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x956ff26833129044d21469f9c9da861ea600c09258a3ac751dd8995d912e8269',
		questionLedgerDeploymentWorker: '0x5bd14c1f5d8a3cf5e98895299edfe740ab10a63abae92ea44ef094d9d8837850',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x3fd302335ac98efdbb95cc44a449fd3957f13185c86c3c3f909c35ce0c9640ae',
		questionLedgerDeploymentWorker: '0x45deb339d1f6ebc1eba0da459dccc05c7fb31a572031174d1c4ea24b310061b3',
	},
	deterministic: {
		questionLedgerDeployer: '0x35501a332f11146fa7653c1b255c0f7e77aa1be4a780784bf51d348e79c711b1',
		questionLedgerDeploymentWorker: '0xd24792e6b977f0e0279cb29374af4d3388b12b29e60ea6ef097ab5f6ad317eb3',
	},
	mainnet: {
		questionLedgerDeployer: '0x3ab3a97cd14d60b373ad949e09d20ee91325a131a12717b87684e26e2374806d',
		questionLedgerDeploymentWorker: '0x56b26fd3630bd65088eeb8fd53f4537722587ecee9dd5697210d007ebb592aea',
	},
}
