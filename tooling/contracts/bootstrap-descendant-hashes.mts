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
		questionLedgerDeployer: '0xc95fbe1bde8bffecb2b9314deea17dea2f5bc0bb5d0ce80034e3127a7025fc2f',
		questionLedgerDeploymentWorker: '0x8c84ffa2157ab6e8bc3456a9033b056a77d8d69de76612a3df888b61d9ee8daf',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xfd5c5521edb86aa8e0f2df5480e0abf71134616533419497e0ae846680f3bce3',
		questionLedgerDeploymentWorker: '0x0f1e2ab6ba5bf967b1c693159d03d624e9280f6c5a3ff8c81f8be6d11f8d2477',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xd6994ee1b8ddb3770f79e621cf5a2f54624b2e825c76ea638dd86925ae9a195d',
		questionLedgerDeploymentWorker: '0x2ebfbd632a15e95b01d5830796cd15d24668f3b1a3f940b90d0ff49257756084',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xfe0ca0bdf999ba93a8be25c4168c3c7c9efa61914f8f3287b410b9902d8e44ec',
		questionLedgerDeploymentWorker: '0xa2ddef7fbf0078d175ebac890d805b8c997150b09a526dc3902a0eadb25b980f',
	},
	deterministic: {
		questionLedgerDeployer: '0xfe91eae5420a8e0f78af020928656b0a79140da0b0ceae0c1661098d2ff43b19',
		questionLedgerDeploymentWorker: '0x0f18e4e8839adb75a8db6141d9da3eac9d6825d805e9940b162da0b07a85e9c0',
	},
	mainnet: {
		questionLedgerDeployer: '0x95df01a04c918d4d609034a4a95c10d56306a75058a6b3efaab5c751f27118d6',
		questionLedgerDeploymentWorker: '0x31cecd9be529e9bcc405ad762598eddca3f5218788a3b08c9b9609711f99b080',
	},
}
