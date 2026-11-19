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
	oracleReportDelegate: '0xefbc6256374267222b817f248cd7e59f1c0016aad69d03c028bd6aac2df5799e',
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
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xb471ac33133d19d74ddbbe17d5d29e77f31e287f583f6d133343b964be44ba9d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa6ee6820fd922aa5d427a5b56e3981acc9c2be2a4b9d509984040828379d8713',
	securityPoolCapitalFeeStreamsImplementation: '0x9cf080d4bf9b5c9b4ca7503ac5b481a79783007392e7c399087486d385dbc487',
	securityPoolCommitmentIndexImplementation: '0x60b10e50fb7b4241c9c23ec81bba3b81bae22a7323ea40d869fc70feab4807b2',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xf2450bcb55b759be8a324334907f5113787c6d4da8937dbe96166068bdb012df',
		securityPoolDeploymentWorker: '0x4c2ce3decd3aba84b6f669d087ea00dbd9566a8e0f37940979e140a998a9ce68',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x73d3b399be3230903cc66cc22b906c76f3c5c0f4f3ddb4ae2da328cd4bcec126',
		securityPoolDeploymentWorker: '0x4c093f0d340c116b17dbd42165a196040d4ade7499c4d8fbc081b5cd490339ca',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x2244f3113a24b9fb9048d97c6d73a3b07ec85f7fd1dc706224b90d22e639012f',
		securityPoolDeploymentWorker: '0x3ee260b2dad9e1e10f2a23e4a14fbd9f4037430bfb34cb585bf0ddf87d9879f7',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xa084dd88b5f1f0160cc816ef598bb5fa442a7df66bb04c0dd3e0376aabc0be9d',
		securityPoolDeploymentWorker: '0x880096134101a321c46a0d2bda65d40ecf7c147720c8df09e8c3ec0a65305a87',
	},
	deterministic: {
		securityPoolDeployer: '0x14ae667bc940e5c6fef9fcb2e9b1539d1cb21e5fc13045839c750493bbaa7071',
		securityPoolDeploymentWorker: '0xb64cdfb555124e7c1daa4a56efb0dbcb284462fea0d4df1fc033e591a076030c',
	},
	mainnet: {
		securityPoolDeployer: '0x13d22bbbb0e7864361228f43853043e6a08d25ed54057c64850554abf6679841',
		securityPoolDeploymentWorker: '0xa1f26f0c14c3a6add4fc192536d10970d2c922598685dd779dd6ebdba5ca1e3a',
	},
}
