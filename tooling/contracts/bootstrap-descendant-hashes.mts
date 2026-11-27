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
	securityPoolServicesCreationCodeFirstChunk: '0x245b1c77df677b1aaaf5e5e04bfcc30294f0f6ccb39f5ed21e36274319ec2815',
	securityPoolServicesCreationCodeSecondChunk: '0x75e716048f18130f2cc270a7a79ad637ab512980e2603112af7620aaff585564',
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
		questionLedgerDeployer: '0xd264699b8394a651ac40dfc4db38b16002677fd522371d18628940819d310d25',
		questionLedgerDeploymentWorker: '0xd2706578871340f861db6b7a7e25ccb207b48ea90e858cdae715a79e9fcaff56',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x70de28ec3ef70843a0f8045396d7056f9eb2c4ae0909b46364c6f348c30f73e6',
		questionLedgerDeploymentWorker: '0xd58d0616b9210ffb25d0e50bcf8e7fa9f3b6cf73b5dfcbfb52803b73335ccf11',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x1a804fc7ed27006629bfb08e755bb7fd67d9828e82c672f2eef4d8fd490f1e49',
		questionLedgerDeploymentWorker: '0x872e784ed171c0f65fb97fec19820628627ff07e576f1d70bccfd8001a55a4e6',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x3aead5b3c8d51809346c0d3dd41d4895e793ac5bb97b1303657e0816e47b08e7',
		questionLedgerDeploymentWorker: '0x0a475d846127e904d036ff39222e63460eb981a09afa5a437da9e85f7e8f1dc9',
	},
	deterministic: {
		questionLedgerDeployer: '0xedff6985216a7896313571bfb19ded9e8d19984c71570a6e6166759b36d33fa8',
		questionLedgerDeploymentWorker: '0x64cae20401a8ace5b8d26d983711230e430d5e1a62d7fc478c06eb3ffad5ca9f',
	},
	mainnet: {
		questionLedgerDeployer: '0x218c1c8f7199d165e8a94c33a3f4f39b62c4b6b3dab62d7854469fe8f1129422',
		questionLedgerDeploymentWorker: '0x62c6ab1c51448aeee09dd97d4094eb0a1f11fa86be3bb5567009817f62333acc',
	},
}
