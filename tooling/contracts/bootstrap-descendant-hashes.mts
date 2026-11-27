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
		questionLedgerDeployer: '0x5e5363e36f388fa2f0af805b01de1b1e232ed86195ac1d35c2a8de9b85359027',
		questionLedgerDeploymentWorker: '0x0866ad627873c8b1952598c9888d826727319a7b512cad96708272a36b399f2a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x25b3d8aa26c761d00b0162bf27b3d1e3a559a068e5485c5e8627acc51f0bd4cd',
		questionLedgerDeploymentWorker: '0xd97c6c32d7a68e3c381206af800df7a3353edf60851b3d89060e45db1a7ca02b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x8a27d387db22c4f03b274be49eb56e6cd73bcc5c6cbb9164b951615878eb9263',
		questionLedgerDeploymentWorker: '0x9a852b824d56dfba7f0da68113e5560ec93dcc6beece28d827283fbb2fff204f',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x2f1ad008bcd5f03b9b332068bbc566241d24d9050ec4db33d9b861513f229cf3',
		questionLedgerDeploymentWorker: '0x8abea6b15d68e22323fd7fa7799bbc8d0d9acf76d154662864a83a314e1b2d24',
	},
	deterministic: {
		questionLedgerDeployer: '0x594bb91c5660f0a22b5c6284725fa792604e0f83cb8f50a3a8ea2fac0dbccce1',
		questionLedgerDeploymentWorker: '0xd62e814d8a5906804ad7cf6815362fc9257c691c30c32155063020dc5b21aeac',
	},
	mainnet: {
		questionLedgerDeployer: '0xf2c5925002bdfaf9fdbaac558b2e58f1c12b1acbb14c5af3a09bef466d6dccbe',
		questionLedgerDeploymentWorker: '0x5c4a9709761b8a5b4551524a8a44b0a929636d037480cdfaccec4e9706b9f856',
	},
}
