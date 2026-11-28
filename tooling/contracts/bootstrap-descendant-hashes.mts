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
	escalationGameCreationCodePartOne: '0xd9db135a2d64f977fd41625c9fb3c5daaf6914977049a50d4d06a911ccde7ea6',
	escalationGameCreationCodePartTwo: '0x3549bb9b391bab6d6e8bb8c35cae150100df82591f64757f4dbd12b45e66ada9',
	escalationGameProofVerifier: '0xf80f60a0624cf21e4617a44c6cf04fc55aa38b33540194bead0b1532bc251c22',
	securityPoolAuctionCreationCodeFirstChunk: '0x8d654dad23285881a9428a82b356cb95530609ecff6d2f4296590a74c067fa21',
	securityPoolAuctionCreationCodeSecondChunk: '0x72c592f5b8f6287e6d4cc10c775cbb9ac984195ac2014f48b3c116b40a1da873',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xcd683140b4b5f0272501ac4fb4e13224c6a9ee9eaf65d6de84947daba8bb56dd',
	securityPoolCapitalCreationCodeSecondChunk: '0xe88e8deed19dfa2c2ff307938e924e5ea1bc48ef4607591a0db9f708de733bfa',
	questionLedgerCreationCodeFirstChunk: '0x64339a9d53135e14fa62b714526474ed222c73b1bba7420246ad64d521268343',
	questionLedgerCreationCodeSecondChunk: '0x438502e0a09059547ed0bb88a9aa89876b87bed26003630503210319e079e9c4',
	securityPoolForkCreationCodeFirstChunk: '0x49463c3b1a3463ca02fe3533c6323754792d86c08a21044938636f872968edb8',
	securityPoolForkCreationCodeSecondChunk: '0x4aab002dd7fe99431b9704f18b7ccdbd5f700e61713a672a4ac225df84d29d85',
	securityPoolServicesCreationCodeFirstChunk: '0x7cddeb6afd0de056a60bae26797472476bdec80ee0626261e7ce3609249b506d',
	securityPoolServicesCreationCodeSecondChunk: '0x49327b915da72987dd999c43552913564883297ac0bafaa9f95ae34c7eb98d9e',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x327d7009a084344786df14624275215178342e6cd582dd0b33fb7b15c510670a',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5b245be73ddb9927b27e9142e7a80b7e93b2f2c0fc39f527e5ecebabd3b333a5',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b6b63fdb44b1261ccdc6bc8e902f651e7de868d02b5a5aee88473f70fc0e83e',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfaba3991909ed2ba5fe8a12f45b2b6c153dbe783b632b68dfd23d9d297473db3',
	securityPoolCapitalFeeStreamsImplementation: '0xbfab8b3aa658db22c58281a86419dc5fd39df21cb9254e91698b1b3429fd70ed',
	securityPoolCommitmentIndexImplementation: '0xe774e1a02930a2ce9a5a5e097d611b04ce7c0542ea0830003e2d845436ff8e64',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x32ec9d8808debb8d7c5b08c7b610807dfcf7432a458b4a887847a4364f63523e',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x14432a53b706d393c663c8e58852f17c423d606323a69137863f2fec18321342',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xc319853c711c49096625c92b28b60b7d45c317ad9558ba1ad942e30f149a4b01',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x0afdd87609873aa5af6a7e5f953ebbb5a7f4df94f6e3b010b558b7d0a07285d6',
	},
	deterministic: {
		questionLedgerDeployer: '0x2070bd44f9f425fc9c0f6b03b833e529aca16eee9aa0f97bc31a8bfc7050b74e',
	},
	mainnet: {
		questionLedgerDeployer: '0xaedfc781a168bf2e92bc34fb74c03646f3f1fe4004c0d4e05282b5eb934787da',
	},
}
