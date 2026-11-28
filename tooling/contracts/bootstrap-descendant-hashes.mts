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
	securityPoolCapitalRepairAuctionDelegate: '0x6728402179551042f81362d6113b6b9d2b146df771cca5dea17df42dacd2baf6',
	securityPoolCapitalLifecycleDelegate: '0x31428a034e81d828c53d12c1ceb376add3f3a02d84852ae0b6461518eca20296',
	escalationGameCreationCodePartOne: '0xd9db135a2d64f977fd41625c9fb3c5daaf6914977049a50d4d06a911ccde7ea6',
	escalationGameCreationCodePartTwo: '0x3549bb9b391bab6d6e8bb8c35cae150100df82591f64757f4dbd12b45e66ada9',
	escalationGameProofVerifier: '0xf80f60a0624cf21e4617a44c6cf04fc55aa38b33540194bead0b1532bc251c22',
	securityPoolAuctionCreationCodeFirstChunk: '0x89a96e002b4f0240378af3b9cb170c075bcfd124d0ba14a3949dbf6c768c57be',
	securityPoolAuctionCreationCodeSecondChunk: '0xa4404e2d1942d6031d4125befaaafbb69f06f00726f0f5271343abed687e5feb',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xa7427b127c88d6b3f2afe0e56c547c3001f1dce8470daad3eec44a341accb311',
	securityPoolCapitalCreationCodeSecondChunk: '0xf3082cbb4673f496eecd1f9c59ba4025531c21901b97275ee64a2ce9d851221d',
	questionLedgerCreationCodeFirstChunk: '0x64339a9d53135e14fa62b714526474ed222c73b1bba7420246ad64d521268343',
	questionLedgerCreationCodeSecondChunk: '0x438502e0a09059547ed0bb88a9aa89876b87bed26003630503210319e079e9c4',
	securityPoolForkCreationCodeFirstChunk: '0xe186decc07d365461ed0c93d29b7dbf41d98783fcd67338249c387ae13b0b3ef',
	securityPoolForkCreationCodeSecondChunk: '0x9620117dd1fec603cbb247af6b8377435ba7a82f1896d03b54816ae9a2591f35',
	securityPoolServicesCreationCodeFirstChunk: '0x2cb4f89209d798965c746883acc07410da63a86055f83882d0986af13f6bda48',
	securityPoolServicesCreationCodeSecondChunk: '0x02860d74394ea572db79e5804da37719610625c929fabcd97e55bb44a28409f7',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x327d7009a084344786df14624275215178342e6cd582dd0b33fb7b15c510670a',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5b245be73ddb9927b27e9142e7a80b7e93b2f2c0fc39f527e5ecebabd3b333a5',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x20e0aea57d30e69726f085d1c1c8ac6d468a1d1d9d9f9dffffb70a0007220f93',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x911f9d506c06ab245eab2fb22c3280be794c2890ef7f4563fda62b986fb8314b',
	securityPoolCapitalFeeStreamsImplementation: '0xbb32b53af8174568fb8b903d448c683a6a38ab16cca85f932fa9d86056c2dddc',
	securityPoolCommitmentIndexImplementation: '0x6f5d075e45b08179684135fc00bcceb73ba5116a9d48c6aa25a029765aa81df6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x3972be864048b63b1a91ade7ad9771a611894bdb5d4c3ffc24fd22b0747fc3ae',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xfd459e04d44fc486cf2dce8c384e614c8394e8cbe1087f7e1b1ef0b5674b77e2',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xc45079dffa661d02fb18b085a95ad9207c96be7b38a3107b46f403e0a3ad8a68',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x03504bee15327f3bc614f94c8e1b59d13789580aceccd059f2243b5ef8e2c296',
	},
	deterministic: {
		questionLedgerDeployer: '0x46a5bfaba39f821104440038fcdbc6509f17f695da8b45ab0b6d6e4d0d39f8c1',
	},
	mainnet: {
		questionLedgerDeployer: '0x3326a5bfdf3548e7e60b649be912e11e9421e35dfc71a09afd2f71d8c057e02c',
	},
}
