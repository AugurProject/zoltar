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
	questionLedgerCreationCodeFirstChunk: '0x0962adfbada93320ffd96e5af5f0145a5566d476492308de98aa04f8c312c913',
	questionLedgerCreationCodeSecondChunk: '0x3c0cc32f0bcd54babef1d7323d051706adf6692a5e7863029adf8077875e6de7',
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
		questionLedgerDeployer: '0x075ced9ca38b7fb80ea1724b6cddac02b4d443a805bb2dc0900a7ebe9034d68f',
		questionLedgerDeploymentWorker: '0x3663060ff1a56fe82ad8e62a8020887a260269b4f46735279887bb84afc1654e',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x4ea0dfa253365dcf3722bc7fb02623b3511c145999e4002e1a013c0be85c3174',
		questionLedgerDeploymentWorker: '0xc525cc3015d25ddf45dc772d4a43815737d0d7aa045a6fe7b5ad85b19132eebc',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xc738abc4951c3e202a0b2da7bbb9daaa3b2cf9e36f6df33503f0093ac79e995e',
		questionLedgerDeploymentWorker: '0x8bcb7e08501be0cb21ac600bd802e152a16451c2ce1e9bf70f4126276e42b014',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x6359ed307472bdd17350e57daabe21bfc59c2a3df06b4b26654e7a0de6c88b7d',
		questionLedgerDeploymentWorker: '0x7abfe244227af40503b75090ca942ce832fe7a756895af02203e216e819d3eff',
	},
	deterministic: {
		questionLedgerDeployer: '0xf48c277be07e9d5db94b7bc29a1de645b8a9361cc955d619c8bb1fabc57d1971',
		questionLedgerDeploymentWorker: '0xdee6a755bc7d5dcbda4f1a8e996e6a522f13de07bdf4cf22353f6a16ef79ec57',
	},
	mainnet: {
		questionLedgerDeployer: '0x6847585f0f1edbcdef0d26b3647dbe970367fbacd3a4104e5c488044224ad6ab',
		questionLedgerDeploymentWorker: '0xd18803d9b8c767b44b38b2ab0a8ace4ac9285541eb5999961c374f43a1ff444d',
	},
}
