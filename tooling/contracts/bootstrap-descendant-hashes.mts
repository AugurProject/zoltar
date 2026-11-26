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
	securityPoolAuctionCreationCodeFirstChunk: '0x5f4f22a4ce3c9c8250b6738b5461b38a341cfeb77c08a3d89b3fc6df4902d1eb',
	securityPoolAuctionCreationCodeSecondChunk: '0xd474592e8ea596fcdeabf4ad6c692fa0affa5dc76b3dedde2d685c33bd546209',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x749b7fd03149280faf4182c1d9da4471dfbf1cc985fd0e558449db6560224683',
	securityPoolCapitalCreationCodeSecondChunk: '0x7ebb7166c6a27e881a6ea2e070d16c21131ddacb847026a1a0b795d45c37194d',
	questionLedgerCreationCodeFirstChunk: '0xa6ab77af32fac829462d94c5a2048de793fce6d722026067c4c76898b3a98fcf',
	questionLedgerCreationCodeSecondChunk: '0x8f930a19b52fb5caf1e98f9dac4fc16f512889bf708f1f8708ee9532f77d5c6a',
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
		questionLedgerDeployer: '0x8cc61ff64542326dc393b7bc4db480c672d24d8590136c301b44444134b488d5',
		questionLedgerDeploymentWorker: '0xfa299207a2c244fa8f09db2d671e2e8a142dc91e45eed95aca4b7c96da79a879',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x1cbc7648fb72532b6c5705e942b31d196aa9f3d3ca7317f0e511fb4bfc540353',
		questionLedgerDeploymentWorker: '0x19dda1c4bac80856a6e718653645cb6a12b0a387880810ea568a6e99e4540abc',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xdae6ad7b061947c6e49d734f0889a73248a299c0539cd219fc590ebe10fe3ce2',
		questionLedgerDeploymentWorker: '0x40fa311c95291d1bf0b5cb382ccb4b0dd61ba5a7f9ff92f64fa440023577cdf5',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x82c97b756ecc8bd68d7c282d8d8b1b936260391178d5a068a599a0b85ab8dcf4',
		questionLedgerDeploymentWorker: '0xe1c9be8db1e977478e447d1b7956c9c41fa10b823f9bfbd3359ff2e0508cee6a',
	},
	deterministic: {
		questionLedgerDeployer: '0xc8c96684bd9e1fdb5208d64053cbdd20f160976d1e9c59848136726a5f294fba',
		questionLedgerDeploymentWorker: '0x6799284b77a4c0e33f4871bee3b9f0eea2e6caa2671a1c3ce3d113d391ef7901',
	},
	mainnet: {
		questionLedgerDeployer: '0x4d996a61c92debab23fab1801537e91c7bd16112a2c09f4553d288b23c7e6f23',
		questionLedgerDeploymentWorker: '0x6999254cf0c6c9b8eaaf0f9025048dc8b8eb3d1a617204ddfb8bc7605fbe7099',
	},
}
