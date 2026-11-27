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
		questionLedgerDeployer: '0xf28bf7f036d4f7d2b19e2d4cff076587bb6aea432142a3ee7358e79144f8b6aa',
		questionLedgerDeploymentWorker: '0x5304b4266b64e087c6887dcdfddcf5830a1276e67f2fc6cc56584e4d23eb68b3',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x724e980d174f682acd27cfee9ea8e05f05edc0a1d667d98cb763ab5a1cde536e',
		questionLedgerDeploymentWorker: '0x7098b8b5f575c0356eb39fedd4b4d3233ef55e2003c2d272e59993d6f2f45886',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xbee28b080535278ff58b16d18f71e4b3fc67e98cec31d01b1b09d8c5ad79f851',
		questionLedgerDeploymentWorker: '0x74a88f19308903b8884923576390a49cef3f10bb07e3d090d774d359441515c7',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x35ed065750eef7cc89ecb8ba10c6f8ae856eea98f074c5e6e7dbc115704b306d',
		questionLedgerDeploymentWorker: '0xba592b680629062839b49ccbd6cf473483376d9fbac206d0cbc1ebaec3b79671',
	},
	deterministic: {
		questionLedgerDeployer: '0x47982361b123a776a9b86ea4599db0d0f1e461bede43241f4540e2d259e3bfe4',
		questionLedgerDeploymentWorker: '0xb46172eeb4092c3cfd69ff3acddd3812aebadfe0831a6895e7c4743292d46e73',
	},
	mainnet: {
		questionLedgerDeployer: '0xa18a5358179aab5d5b3ed8199d32c62740afff073b220116b3e79c88d0d99c8b',
		questionLedgerDeploymentWorker: '0xab2f52eb704c181cddd42c2a832399f39201ae139802098cbabbf03b9087b7b6',
	},
}
