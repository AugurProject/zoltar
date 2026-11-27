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
	securityPoolCapitalLifecycleDelegate: '0xa237543d213e37779eac76cd2b788e04a96d5ec15df4079fc5c0cfba5c2ad459',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x2dce59a3c45ad38191a8b8649585cfd61e371312c1a1ef86f75df956a1b0c3dc',
	securityPoolAuctionCreationCodeSecondChunk: '0x8d4b67cbf9d29c91dbd9932d2e2c5fb93b740d2a9a833584ad52e302c807feb5',
	securityPoolCapitalCreationCodeFirstChunk: '0x187c727d5254fd009b234c876d636d5fa9624a3132cb48bc0b41fb28f127d06a',
	securityPoolCapitalCreationCodeSecondChunk: '0x070a3f9f1deb8e4af4720ace4e1406d7fb6da644d631a5604d1b28f0b53f7a3b',
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
		questionLedgerDeployer: '0x421a6bd9afde82326d111ef59d4e3e7ddac2014d54d85b5153cf606e6faf17b8',
		questionLedgerDeploymentWorker: '0xe253322ea886dc4430835abe92009b0c86b0f8982f43944bc639ad3ea3687f38',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa252c50a6d32bfb3f7a187ddb5dcc760a0e2ba7ecc8081c093b9846f6b4ca559',
		questionLedgerDeploymentWorker: '0x2b1f1211055c4431bd73d61a65331d17495b9bfa402d72c83d2e74470f78f8f3',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xe3945b4c9540b0274407242f387e2aa16641ead24d296b053922c6e5d6abb84d',
		questionLedgerDeploymentWorker: '0x2ea7903dacb9439149501adbf3f7b576d36b6a161870f7bcf58a6fe02ad1551b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x05f78d5aa75f57c774c8106a247aeb15298807809602b2340ef2a82162cde225',
		questionLedgerDeploymentWorker: '0x1b3b7e5a1ee1d3f4843771080287efc14fdee54979cfc8f670297e1c4f21b792',
	},
	deterministic: {
		questionLedgerDeployer: '0xdb5a11d87a6bf1b453433efad6c87f6a5d9e8436a226c384e9a0b8dede143b06',
		questionLedgerDeploymentWorker: '0x77db048012c14280f5bec2a4149fc911874cea177ffb7e94ff023220376683f0',
	},
	mainnet: {
		questionLedgerDeployer: '0xf6a652a4aeacf34862e6d9816773f74437053521a829387e4c690a6ecb5a91c9',
		questionLedgerDeploymentWorker: '0x710feef8e14262f648bbfdb692d0280873d3f87857fa5aa075812619bcfa1eba',
	},
}
