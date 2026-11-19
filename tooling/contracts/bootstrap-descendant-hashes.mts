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
	escalationGameCreationCodePartOne: '0xc62e53c4ff03611b706b943af98dc012ec41d7960bf9c7bb39cc794d243cde0b',
	escalationGameCreationCodePartTwo: '0x58f1102ef90e7e4b0816f615c5aae27047306034d44e132f0c1896b86c415518',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0x2c3e959a6ec587660e530b3d4e35aa608dd75026bc35a844488ee1e41f79e11f',
	securityPoolAuctionCreationCodeSecondChunk: '0x97b91c4a6ecfd2857fb61dea7397a6e9b5f8662537e34caa46fbd680deade149',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x9e28f13d3c1b1cfbba79bdd4dde287af09cebff546cf17dbc404b873d5f84a25',
	securityPoolCapitalCreationCodeSecondChunk: '0xbc65dc1f9964c3db3debb3efa8332d9d67f4d280bba5602c24bbae346f4bc0f8',
	securityPoolCreationCodeFirstChunk: '0x9a74d4b594d66e2ae596c87695f03a44fdbe4df8b4c66e10e1831370081bab40',
	securityPoolCreationCodeSecondChunk: '0x9d429eeb9aae54d2f62ef7e9b9dba4c0d5c270c9ae6be1836bdcc30f163bea56',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xe1fa2920c0cd57f6d630f0fbf06f6aa59450455699da77ccf6c791fcf7dad486',
	securityPoolServicesCreationCodeSecondChunk: '0x1ba89b20cc678bccb3fc07c3a8954b3c2e0b81ed402e69220f03655b98169327',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x3a2bb9fb1a320314298139c4107206a8307e59bf1797224dac56690bbda5d92e',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xedcb2c8eb6372ef517f856d6fd0b135d7ccbece1a6398a7367ac53126b05cdcc',
	securityPoolCapitalFeeStreamsImplementation: '0x9cf080d4bf9b5c9b4ca7503ac5b481a79783007392e7c399087486d385dbc487',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xef119ea2b5aa8a6f24ecc934dff7cedf754e707f9bfaf824786726fb3db8f6a9',
		securityPoolDeploymentWorker: '0x3a467a608afcf54555e701caa8feb294bcde208d0d8301f617ea2625ae355877',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x39c7fcb458e829f663cc2e7f3eaebcaf7b898cba499f6ea0e3254fe09a97252d',
		securityPoolDeploymentWorker: '0x7c8c9eabf23203ad57a83233ced0da2b60069fa26ed8e5acf8e4a5e06b994d4d',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xb3c986fa6b6d81a23f94054aca6fb85d3c5b52eccb1df17a74c3c63915154e4a',
		securityPoolDeploymentWorker: '0xa8f97bada131bf587aa03a9d321de0903490619c0af6933497b785d5f9144b2f',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x6c9960a4bcdc26a5943db2f86c27e0d9666d2f32d84ba70fe76bb05656f25c01',
		securityPoolDeploymentWorker: '0x50e43613fe06df65b97be346971ef0e817acac81d0395cd7a2dc695eb39dd71d',
	},
	deterministic: {
		securityPoolDeployer: '0x70ca5ff1902cf65da881e13a6cc02b2b44462a288a51a92e291745b3ca70bdfc',
		securityPoolDeploymentWorker: '0x2e8d077e3f99a615056862c07bb1d2f7f251029d82cef5f1da615ad90dca1cef',
	},
	mainnet: {
		securityPoolDeployer: '0xc27f4ab70e7aaedf7d4f8b02dca02eb60efda98733c1eac16a3fc4d7c1e900f3',
		securityPoolDeploymentWorker: '0xfbb697ac2aa5f467fa2fc742fcb6969c6bfdfb4356eb27b2bb163f582fffdbd8',
	},
}
