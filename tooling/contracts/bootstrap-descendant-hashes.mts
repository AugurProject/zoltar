import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the question ledger deployer hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	securityPoolCapitalRepairAuctionDelegate: '0xe5ab38eccb00ab6dddc5689d9e21239be392e0997596183375a8201e92d7cfd1',
	securityPoolCapitalLifecycleDelegate: '0xf915182f9b249beb282bb50537c7f95616dd288ea6ac6117e1d3e7968b194721',
	escalationGameCreationCodePartOne: '0x6c8b44be45827ab7f0b553848fd36fb9840f642d77ada716fbe1294c6e3bd587',
	escalationGameCreationCodePartTwo: '0x572a87ed56c577a57692ca951475256825262e35852edb0135a62cf84cf7d34e',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0xe67758e92cd5e73958991cda8f3b5b1b1cc95e2a6a6425d1b356d48a5f4fc175',
	securityPoolAuctionCreationCodeSecondChunk: '0x26772b0049b09be8c318f94b4f4a2d12cf6f6d866b538555a7a34477beb25b6d',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xaab4a569d5fd9aed7458f90edff354b5a19eb8981a7ab59e2d8c071bb4bad76f',
	securityPoolCapitalCreationCodeSecondChunk: '0x8fc1c18d06f03369e345ca12854091663b26f5e78d42d63a865010eb5239a9d6',
	questionLedgerCreationCodeFirstChunk: '0x691f11c60c59a18ebbbb3fcf5d5de304c0603d9e14aa8c33d59fa001f3a86e65',
	questionLedgerCreationCodeSecondChunk: '0xedfaf6d8c1139038d5e30bf2b9e09172187d6c681f5163f1ed83f872bb8e3a7f',
	securityPoolForkCreationCodeFirstChunk: '0x8c405312859e853d47476fc83f6377bc57d36bfe4d2ad29cde5a3e76dd796516',
	securityPoolForkCreationCodeSecondChunk: '0x077cd869189e8a76467100670caef018beca1d76d3af9e2fd9394a9b0ef11ad4',
	securityPoolServicesCreationCodeFirstChunk: '0x368d8c4054e7feca57217b3c649fdb28cc812ce77aeaea2d2499aa49511730aa',
	securityPoolServicesCreationCodeSecondChunk: '0xe24966ab834ecf51f0afd176bfd371130f9a7a424ae8d225c67dde4f9d1307f3',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x99468618873223fdb2b76ad1cf81b8c39c610d0593d0962fd5c848654ef6b46f',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x1342de21be3ffe97d7956d1ed0c80d1eceabd7093808016720be5c6e28192fe4',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x298c9277a921244626cff3adf6803b8e5fff7b90811af8cbf9ed295eab7d3820',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x089c4cd05c58a704b91a45118f09f2ce800b12b8ff5945f21e28b5e2668bc86e',
	securityPoolCapitalFeeStreamsImplementation: '0x0b7edeb633b7562ec6f1203acba110465d703309aead477794818ecbd762f190',
	securityPoolCommitmentIndexImplementation: '0x8f11896ff772f3e843c1f790d90a6f69878588310cb7e17646d6efe738390299',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x9209284affd3c1d2a3818523fec7754a1de3616ecbcfe34da071959692ec1885',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa00635ff8cc0b68d35cd87c89eb562091431ff0c40caac9b19fca01f24542dc1',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x6d76b9b5701aabd62969639acc50f04d1e9462cb48ffd0dddeb3f6d8103f4025',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x32112cb0f1a2d5dadd5b295aeed8aa85410fb1a2c928231df05f9b29786b1a4a',
	},
	deterministic: {
		questionLedgerDeployer: '0x6b20fe5c32ded6774758c02d9ac07cf6eeed730fba2098ea1a509c8aa0de6b99',
	},
	mainnet: {
		questionLedgerDeployer: '0x7ecb98f6525abd3a6e9a1d9eddb747194d0a8cd78d260fe974da8651594f87d2',
	},
}
