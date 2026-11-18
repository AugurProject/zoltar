import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the security pool deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0xd847135f3357399a58107578526b996fb9595ecb7ee63220a09349c997dcdb05',
	escalationGameCreationCodePartTwo: '0xdeb7e8ca8cb12dc82dd6b4183473754ad19d6c2486262e890995dbd7a696d613',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x48b3836f1b6bb205870feaf5667fed685457b2eee79b3eadc71a12270930970e',
	securityPoolAuctionCreationCodeSecondChunk: '0x3601780d2b0dade60cdf52f2fae693e20e5d6b3bac6a73e01b3f5ec22e8295ea',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0xf938ac90e0712d773af0e06ff008f6731730b45d7be26734f9151f22536ccfa2',
	securityPoolCapitalCreationCodeSecondChunk: '0xcc19f51dd9859f4ca4c303edc80f0f2ece51871a681c889cc72f19caa65f3534',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xfc95e05adc7e6d6e5d922cf2460773ab350e651c16443416d1c8b17d0330e5b6',
	securityPoolServicesCreationCodeSecondChunk: '0xc0da9cfd3ace1cbdc181cc642f00d4aceea3e7edefe636caaef17871664cb23b',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x069ec7f03aa297128c743d995cd8c0a981491b184a7c875f3c13205df769d38d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x61c7b2e841bc32a35acb904533a64958813ec08c12d80796db73553114af3633',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x6b0463ea550a3e1a983abf29008c1728839811b35cf84e5327812ac81288b804',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x2bb6c94ca89e47c511cd3bd3e99692498805f84d972ae7ecb982b119ddb236ad',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd32d9eaf75a29f53f451a5feabda1b56ad4caf6953d6e4571fa286a529925e0c',
		securityPoolDeploymentWorker: '0xce604155d48c7ea3644af4909dc31b2c8ab60a2702fa95b75258d53fa97cd14c',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xad3ebb2e59e5c841a7638c4cdddc50affbc1557e4f1ffa8daa09ee150bdbb7f4',
		securityPoolDeploymentWorker: '0xfbfe67fe39eec90439111b49d89ff5da40bfc5011a48688143fefe044eeb8fbe',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x3a3ffac34119bfe349a0bb81f14cc05d92f990dcc9d762fec65ba6c7e6f721a7',
		securityPoolDeploymentWorker: '0x157b0f439c7e9474207134650a0d36e881bb384dbfb7419bcffab6a3bd53e710',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x7b52d89df159a0101c10935f87627379aa2597c52576f2a2a6654c87053c0fd8',
		securityPoolDeploymentWorker: '0xe9d31de4d78eca5c4d8420edeacb12aaa3966e61a9893e0a99b02b7d33508c6e',
	},
	deterministic: {
		securityPoolDeployer: '0x0d819b9348ec8bcb07ce52d7263a1207f6639b63052c634b2bb0b7e11370a90b',
		securityPoolDeploymentWorker: '0x2e17210877cfc1cacc12fa77fa2651c1cce541dd6fac32a8c881bcf3c7c48288',
	},
	mainnet: {
		securityPoolDeployer: '0xe7b5f4faefe3e654865c8b0fb577df7977ef2e9c5e95a0077b64a032eb09f75d',
		securityPoolDeploymentWorker: '0x309c6fcd0a44572a6a608d5f14358aa34c6ea9c7104a4cfab4f1b2eb7f93b5d5',
	},
}
