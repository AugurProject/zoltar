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
	escalationGameCreationCodePartOne: '0x8fac41fd25a39a5823be9ead7c52c7a36b91aa448534c05aa76304c5e9b3d78e',
	escalationGameCreationCodePartTwo: '0xa441f22237dbc23567ae6e8e0e89b41f0aa02f07947e6b43f7fcd0afe87824f6',
	escalationGameProofVerifier: '0xf80f60a0624cf21e4617a44c6cf04fc55aa38b33540194bead0b1532bc251c22',
	securityPoolAuctionCreationCodeFirstChunk: '0x89a96e002b4f0240378af3b9cb170c075bcfd124d0ba14a3949dbf6c768c57be',
	securityPoolAuctionCreationCodeSecondChunk: '0xa4404e2d1942d6031d4125befaaafbb69f06f00726f0f5271343abed687e5feb',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xa7427b127c88d6b3f2afe0e56c547c3001f1dce8470daad3eec44a341accb311',
	securityPoolCapitalCreationCodeSecondChunk: '0xf3082cbb4673f496eecd1f9c59ba4025531c21901b97275ee64a2ce9d851221d',
	questionLedgerCreationCodeFirstChunk: '0x6bc45cda2eba5bc255c104603719c2ac3ed02d244d8a820da282b06a648eab9e',
	questionLedgerCreationCodeSecondChunk: '0x95c384185fd8d98689ce10c4fc08abb58ff04043c2743c2f2e747b3e458a21b3',
	securityPoolForkCreationCodeFirstChunk: '0x49463c3b1a3463ca02fe3533c6323754792d86c08a21044938636f872968edb8',
	securityPoolForkCreationCodeSecondChunk: '0x4aab002dd7fe99431b9704f18b7ccdbd5f700e61713a672a4ac225df84d29d85',
	securityPoolServicesCreationCodeFirstChunk: '0x7cddeb6afd0de056a60bae26797472476bdec80ee0626261e7ce3609249b506d',
	securityPoolServicesCreationCodeSecondChunk: '0x49327b915da72987dd999c43552913564883297ac0bafaa9f95ae34c7eb98d9e',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x327d7009a084344786df14624275215178342e6cd582dd0b33fb7b15c510670a',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5b245be73ddb9927b27e9142e7a80b7e93b2f2c0fc39f527e5ecebabd3b333a5',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b6b63fdb44b1261ccdc6bc8e902f651e7de868d02b5a5aee88473f70fc0e83e',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xfaba3991909ed2ba5fe8a12f45b2b6c153dbe783b632b68dfd23d9d297473db3',
	securityPoolCapitalFeeStreamsImplementation: '0xbb32b53af8174568fb8b903d448c683a6a38ab16cca85f932fa9d86056c2dddc',
	securityPoolCommitmentIndexImplementation: '0x6f5d075e45b08179684135fc00bcceb73ba5116a9d48c6aa25a029765aa81df6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x7a1f8a771db8059da5f9a7ea7915453c43b55f921fbc5185ea7a25807e6b56dd',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x2744f2b25370c2c39e170e3bfc3c73b8cae2387fd37f49ad7a7b8c6c453b74e5',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x18736159c8e6399c9a66831538bb1626f7fc0900ba5c1f95abb11ebf51982df0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x6d107642f8d27b654b4a2454a17dc95cbe9fce6756341e00b507cffa7e2f0d39',
	},
	deterministic: {
		questionLedgerDeployer: '0x9aa7400f3758180016f4fbbfb4702f37c22ca4c5bfadb3f140e2c28518aacc28',
	},
	mainnet: {
		questionLedgerDeployer: '0xcfc6797e47c881e2cd3c803fbfa33eed6c28e13e511f50fcef27159899f53b64',
	},
}
