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
	securityPoolAuctionCreationCodeFirstChunk: '0xe14dce81f72d820105d94465402aca250c41e702bd3516d472ccf95e55dcf0ed',
	securityPoolAuctionCreationCodeSecondChunk: '0x9fa08077fe6f1777d33a15c9239b2c5efc3985cff0231bc0ddce50af018a2888',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x0031a0553fdcf60c33f40fb1636de8ba77a0c651ed0715683428a194a927eb50',
	securityPoolCapitalCreationCodeSecondChunk: '0x4784c5c34864db3eb7a015b98c37f11fd66221e880b2332e8ffdc5703a801070',
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
	securityPoolCapitalFeeStreamsImplementation: '0x8901810d136fa8a727273a87efcc4eec89c9a4254d88947fe5acf9b1603607f9',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa21e4833a24630d7831149228ea50acee6589e038590d9e285fef7341df21ccd',
		securityPoolDeploymentWorker: '0x1007997557b384e7d99c005a0e4e3776603419cb5c9ebf788ce7597b52a54ae5',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xadfa829fa469f91b261147dbbbb7e3e346ee097dc74855a0fee45a3249f4d0b3',
		securityPoolDeploymentWorker: '0xeb4c1548ef0def1adc8e86eb13dcaa6acbd50041c62e70eeaf3b1537c474e289',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x97628fd3ecbbcc2070dba5d66927f3a7cc6b2bf16fd195a269031611ff1d8c6e',
		securityPoolDeploymentWorker: '0xf6fd23c9c0033e9ed8efdfdbac814423d1d716203c2b6b3daa26fdbc07d16dee',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xa4ea99c794e1e454c43fb4cf925601b498078ecf40ecb17f2e24facbf1130d1a',
		securityPoolDeploymentWorker: '0x32cb4ca0da6b6302272bbd9bb3cb78e488e021b1e169082dd5c5abe72b4832a5',
	},
	deterministic: {
		securityPoolDeployer: '0xb0d06873ff75397b3f6c006e8f4207f961f3df5bc4636e084c1640b824193237',
		securityPoolDeploymentWorker: '0x88ec6497ab887678cbfc5d60e41504b73c071804e90edd527fee8eab9d9b96b9',
	},
	mainnet: {
		securityPoolDeployer: '0x3d1d4497d379784abe1c850ece4e34a46dc987c378b5de41b475d123924d1948',
		securityPoolDeploymentWorker: '0x9d27f1e2c79c70b1029c0e077842772b353ef4e14d52283a428c95c681dc1b92',
	},
}
