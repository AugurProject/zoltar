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
	securityPoolAuctionCreationCodeFirstChunk: '0x1735d8431485d75c583c15cc3eb1ad95c38ce54a9be0690a01d612351832c863',
	securityPoolAuctionCreationCodeSecondChunk: '0xd367d632bada9c4744fc37658f2250a8380a86c209a7ba7e1eef6a1c422edbc0',
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
		questionLedgerDeployer: '0x05a36de4ed68ad027ccc929354c2f8fe8ed59206cf2f0232249372cf69d06d62',
		questionLedgerDeploymentWorker: '0x0ed22a8d36eeaaffc4d6c6d4a0d3bea090652e388cf533ad5f44a8c0dcdc2acc',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa2f2f7ed671f8eefb49bdf6bffbfdbaef1ce87436a9bbaa3926b5e7b6bf2a301',
		questionLedgerDeploymentWorker: '0x47d27cde52f4f270dcc60dd7b1eee635695f617929febdd04c2e4f8ce601df6e',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x5290e05cc6882a49c01ea7acab23f9c914dd08ba6ad4fcb1901c33425fae69d0',
		questionLedgerDeploymentWorker: '0x13f019cf7bac14836c5121dca4192479f26d1d3147aa2da90602369098173db0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xda2bde5a53aa21327eb6051596f376332284ecb6dce6bcad739d3b61393131d8',
		questionLedgerDeploymentWorker: '0x9e7662f9de85fac1aa378d5adeac36c6b5d32e1e2cfe7541966a735a0b77d4ad',
	},
	deterministic: {
		questionLedgerDeployer: '0xb34f33480d8a62ce0bd94e34cb16efdcd783878d6a7da8d5ef9f6c99805cdaab',
		questionLedgerDeploymentWorker: '0xea3cf9b733162680cb4e6fa71f68930e18106a58f5d2d6ec34b7f94ef2ff4468',
	},
	mainnet: {
		questionLedgerDeployer: '0xf40d3e049b2f919e0d1c6ba7a3c76e00aa7de8572e1fab4c7545f7c09f03f896',
		questionLedgerDeploymentWorker: '0x71c53ed25d3e0ee58c74cd2361609cba59ca406110d796f7bb8c67d09e498244',
	},
}
