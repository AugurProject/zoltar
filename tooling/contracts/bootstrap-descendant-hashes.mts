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
	securityPoolCapitalLifecycleDelegate: '0x2b43c5ad4215a915eb17c82d3e6b37d1944bdde9abba7e210796f796872149f1',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x2dce59a3c45ad38191a8b8649585cfd61e371312c1a1ef86f75df956a1b0c3dc',
	securityPoolAuctionCreationCodeSecondChunk: '0x8d4b67cbf9d29c91dbd9932d2e2c5fb93b740d2a9a833584ad52e302c807feb5',
	securityPoolCapitalCreationCodeFirstChunk: '0x9b372a3dcc3f99d631e48cb2af52e0dd2f9d1950eb98ce405d8d4cd9f5205e4d',
	securityPoolCapitalCreationCodeSecondChunk: '0x1914bce4e3e5803b21fc93473d48439004d7fc6e5025d6f016c972d26cec0c7e',
	questionLedgerCreationCodeFirstChunk: '0xec6878189154d55d32a963c07897adaee5ea607eb75b0c09c1b8e838e918a340',
	questionLedgerCreationCodeSecondChunk: '0xa0d4c05863bc290b2564b118540d64b63373eeeabe625a581630a171a54837aa',
	securityPoolForkCreationCodeFirstChunk: '0x628c4caf7f6406f5d038634f36ee91faf2c0f6746900cdbbba217f3f9bd23e8e',
	securityPoolForkCreationCodeSecondChunk: '0xfba0363dd7b46d97a0f98de6667a7a5f616b4babc67de790a096f81f3d9beb2d',
	securityPoolServicesCreationCodeFirstChunk: '0x200169d7c0e378dafa8030bac01169fa1464a76697f14567d20ce1f5f977dac2',
	securityPoolServicesCreationCodeSecondChunk: '0xb87538e128fab6bbd630f58ed21364f0dbe7ee23389fd6478f528155475d3469',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x701a682dbf0eb5144799a83d5a2ad6951fe0cced4e9f5b5e4600d7aef949c691',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xcf621c6bdc2538beea0e989c69b558b40805f7f9e1a308cef55cfea31c2bbf6e',
	securityPoolCapitalFeeStreamsImplementation: '0x78a6f7b63a133afb25bdab77df650d341e97220ed739e3cba0313de30aa5d909',
	securityPoolCommitmentIndexImplementation: '0xf6833bb3f36f8274fd127547d14b733fd9ae89679414d113f6f28ad30ae5c299',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x605c1035b8ca53fc14b59c8fb283478074cd93fadee7800fd5fc7bfa8d843e36',
		questionLedgerDeploymentWorker: '0xf837cee869600ef40e91bf5c2c2296848d8e4339123a092b4a00f612074bcebc',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x46b0a50226796269bd0eb2b39a60f4c1c7148bbb1d4c6cbf50102849507490f0',
		questionLedgerDeploymentWorker: '0x23e6e2fa5d59d234d892f4f0993690357c6c89bbd60693d7ac7b4d3c8fca8dd6',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x55c082d9014d774c0f9b00596a1617e9baf4e0cda7a1212fb56f275485310cee',
		questionLedgerDeploymentWorker: '0x165224977a5b18ae550d82eb20472a256aa35f46c21c1a4603df189f819b2875',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x704953f13c44206dc7010ffc539338792b5d251cc658265c00c1ee2339f8e0be',
		questionLedgerDeploymentWorker: '0x7f8253d26d25a9fe3b5fe01a6c59a2b2a21195db8fb7b492882c0f3d938169f6',
	},
	deterministic: {
		questionLedgerDeployer: '0x78064f794dc6623e468e64049696bdc87c36f67b7d2ae13c31ab96b2ed1ba0d3',
		questionLedgerDeploymentWorker: '0x0a507c27196fd7953359cb51fe16a80055a87afc572ea44065b7698d01b5e095',
	},
	mainnet: {
		questionLedgerDeployer: '0x2a8f502bc1bd0d722fc6fdbe38dda3b7df21c2970e35dd0ff6b2806bd25dfbf8',
		questionLedgerDeploymentWorker: '0xd0ce84c7baa3781b97e47503c0855affe2029780d9544b129c071652b35513ef',
	},
}
