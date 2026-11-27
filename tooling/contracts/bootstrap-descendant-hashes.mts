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
	securityPoolCapitalRepairAuctionDelegate: '0xd2e71b937dc76627276b68b541b0534412ca848f77e68e024f5956afc1b9a7dd',
	securityPoolCapitalLifecycleDelegate: '0x7c69985b9a1ecc0e4c84a0e571c2a8fb2ea06198dee6418f9a025bee54d7e52a',
	escalationGameCreationCodePartOne: '0x6c8b44be45827ab7f0b553848fd36fb9840f642d77ada716fbe1294c6e3bd587',
	escalationGameCreationCodePartTwo: '0x572a87ed56c577a57692ca951475256825262e35852edb0135a62cf84cf7d34e',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0xe67758e92cd5e73958991cda8f3b5b1b1cc95e2a6a6425d1b356d48a5f4fc175',
	securityPoolAuctionCreationCodeSecondChunk: '0x26772b0049b09be8c318f94b4f4a2d12cf6f6d866b538555a7a34477beb25b6d',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xaab4a569d5fd9aed7458f90edff354b5a19eb8981a7ab59e2d8c071bb4bad76f',
	securityPoolCapitalCreationCodeSecondChunk: '0x8fc1c18d06f03369e345ca12854091663b26f5e78d42d63a865010eb5239a9d6',
	questionLedgerCreationCodeFirstChunk: '0xf41b312b202e21063ee0601bf83cd11a82d560a235aad592e501d2a2a2bc6381',
	questionLedgerCreationCodeSecondChunk: '0xc57bc61b326a711e3586f9465c945155de08d069da0b530f25c9a693d8c9ad81',
	securityPoolForkCreationCodeFirstChunk: '0x2428ea0cc4c864e73bbafc538dc0e034ac2f6b127c76d36593106de44bda74f0',
	securityPoolForkCreationCodeSecondChunk: '0x88a6df7e1d122192a4139798d3bdf551b43e789c7dbf0fa31d26aa42f4ae3576',
	securityPoolServicesCreationCodeFirstChunk: '0xdf45425769c5cbf8a663517be577766d099c2e1ee523146f4a8893be36240ad1',
	securityPoolServicesCreationCodeSecondChunk: '0x9520e912633b0dbf18453b36f0eb021f07c5389876055cc0bb5315b8227cbb48',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xe62dbc433907b188e9732b13e10b57258d486f087c63c3ef13ae7c5607c80cbd',
	securityPoolSettlementBookCreationCodeSecondChunk: '0xa008eb0142ddb4e0723223f437a6febce1876a4d342e5d1fa789d20275b57fb2',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b6b63fdb44b1261ccdc6bc8e902f651e7de868d02b5a5aee88473f70fc0e83e',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xe71d8474612ef80c701577d47ae1668469b3d8f233711bce89966e2d00981269',
	securityPoolCapitalFeeStreamsImplementation: '0x78a6f7b63a133afb25bdab77df650d341e97220ed739e3cba0313de30aa5d909',
	securityPoolCommitmentIndexImplementation: '0xf6833bb3f36f8274fd127547d14b733fd9ae89679414d113f6f28ad30ae5c299',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x30c90170d08e5165d1abfae936b0fc1d786b29ee378402d8ef474befc95e637e',
		questionLedgerDeploymentWorker: '0x05a00a810c6253ce30217bd69195e631fd45140e740b30a4d4277363fa902a57',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xae1e2b9a7e8baa401dbbfa420ad97cd26e184a038f7cb37cb5bd896318eea50c',
		questionLedgerDeploymentWorker: '0xf6d042a3adfe53a328eeacb818680020bd7b64870ca033088cf0aa2edf9d35f4',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x55afb91bcd4fe4dd54816a5f18eb495911ec044242beab213ffcb54a17343cd2',
		questionLedgerDeploymentWorker: '0x5d8cedcb862ada533d1eb6cfc301ce153f048d35bdc2fcdec1ee1f88e260da5c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x822758154ac2d8ba089d822161bb2a6c5526fd265bc4b2f85ec37118961abc02',
		questionLedgerDeploymentWorker: '0x0c7fc2a02af72de29dfdb3e17b06a2bbc7f64187d4b55579178c7b396c7ec5cb',
	},
	deterministic: {
		questionLedgerDeployer: '0xd46b21a261ef149de3dda61eb03ac6da10e054cc8c4050ffdfd6c13c8585d194',
		questionLedgerDeploymentWorker: '0x3b997afcac17145f23a49a363198f4da3fd922f7a49b4e04252753ce7857fffb',
	},
	mainnet: {
		questionLedgerDeployer: '0xa4cd4ce8951ddfdb3dd7446a79ebb1702589dea205d2cc08a6fb1c847c1aa094',
		questionLedgerDeploymentWorker: '0xd565dfcb3df3d3409f099a967662b9d3f3d1d83aff578126f99913951d53391d',
	},
}
