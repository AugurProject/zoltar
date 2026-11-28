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
	securityPoolCapitalRepairAuctionDelegate: '0x5c701964c8315cab7427049a71aaf723dad63cdebab3b26d778696909eab50b8',
	securityPoolCapitalLifecycleDelegate: '0xc476ac5e17f26258d0a00794657b2ab812929f13367727c305653dc987b33471',
	escalationGameCreationCodePartOne: '0x8fac41fd25a39a5823be9ead7c52c7a36b91aa448534c05aa76304c5e9b3d78e',
	escalationGameCreationCodePartTwo: '0xa441f22237dbc23567ae6e8e0e89b41f0aa02f07947e6b43f7fcd0afe87824f6',
	escalationGameProofVerifier: '0xf80f60a0624cf21e4617a44c6cf04fc55aa38b33540194bead0b1532bc251c22',
	securityPoolAuctionCreationCodeFirstChunk: '0x8d654dad23285881a9428a82b356cb95530609ecff6d2f4296590a74c067fa21',
	securityPoolAuctionCreationCodeSecondChunk: '0x72c592f5b8f6287e6d4cc10c775cbb9ac984195ac2014f48b3c116b40a1da873',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xcd683140b4b5f0272501ac4fb4e13224c6a9ee9eaf65d6de84947daba8bb56dd',
	securityPoolCapitalCreationCodeSecondChunk: '0xe88e8deed19dfa2c2ff307938e924e5ea1bc48ef4607591a0db9f708de733bfa',
	questionLedgerCreationCodeFirstChunk: '0x6bc45cda2eba5bc255c104603719c2ac3ed02d244d8a820da282b06a648eab9e',
	questionLedgerCreationCodeSecondChunk: '0x95c384185fd8d98689ce10c4fc08abb58ff04043c2743c2f2e747b3e458a21b3',
	securityPoolForkCreationCodeFirstChunk: '0xe186decc07d365461ed0c93d29b7dbf41d98783fcd67338249c387ae13b0b3ef',
	securityPoolForkCreationCodeSecondChunk: '0x9620117dd1fec603cbb247af6b8377435ba7a82f1896d03b54816ae9a2591f35',
	securityPoolServicesCreationCodeFirstChunk: '0x2cb4f89209d798965c746883acc07410da63a86055f83882d0986af13f6bda48',
	securityPoolServicesCreationCodeSecondChunk: '0x02860d74394ea572db79e5804da37719610625c929fabcd97e55bb44a28409f7',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x327d7009a084344786df14624275215178342e6cd582dd0b33fb7b15c510670a',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5b245be73ddb9927b27e9142e7a80b7e93b2f2c0fc39f527e5ecebabd3b333a5',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x20e0aea57d30e69726f085d1c1c8ac6d468a1d1d9d9f9dffffb70a0007220f93',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x911f9d506c06ab245eab2fb22c3280be794c2890ef7f4563fda62b986fb8314b',
	securityPoolCapitalFeeStreamsImplementation: '0xbfab8b3aa658db22c58281a86419dc5fd39df21cb9254e91698b1b3429fd70ed',
	securityPoolCommitmentIndexImplementation: '0xe774e1a02930a2ce9a5a5e097d611b04ce7c0542ea0830003e2d845436ff8e64',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x1c6cbdc2fc152df553ee8eedd216a5f5c768700833887445094e4105ef14f269',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x336d1a346a218be3082a42a05ee4956ce53497de94bd500ccbe61c2086620843',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x2be23e853b2e0e52b579f40f7d0335ca2958108ea6b680e3a2046419f64ceb5e',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x91e561d7e393b6531e8e459ce692352017f6153d9496e2a8508f9e94d2d85ced',
	},
	deterministic: {
		questionLedgerDeployer: '0xec31389118693d25fad0d6a557f2e905e035511e7f324081e60f30d651f564d1',
	},
	mainnet: {
		questionLedgerDeployer: '0x2cafe890141092c53cc9c7260f00aa73645d02bd031b9f236ff6dde5ca8a77bd',
	},
}
