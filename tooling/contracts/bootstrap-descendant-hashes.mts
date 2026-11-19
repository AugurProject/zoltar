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
	securityPoolCapitalCreationCodeFirstChunk: '0xba359bdccc4ccf594b78f29c11e1619ba063d157a77bf9ad2bbb02ee285c99f7',
	securityPoolCapitalCreationCodeSecondChunk: '0x3852800d0c359857fdd352cc2840a3f49c4a0824a00f4546d18ef0587e3c498e',
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
	securityPoolCapitalFeeStreamsImplementation: '0x920971bbd70ba37236a39e0b485b753b474e3f2481d975cb624c6a349b0d8d5e',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x700c9cb4ec311dd7213a6e4d1758b2ef23d72e8e409f94cbef3b06ef0c5c098e',
		securityPoolDeploymentWorker: '0x9ca4c3f825eb2f0111caacebfeb9fc3725d84188879036b1b711c5579998bc36',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x59c4a725ec2a293f299ac223a3b7fe67cd623b410e8411ab05d5b531a3ff9db6',
		securityPoolDeploymentWorker: '0xe7237cbb134ca48d5d9250825fc491b4616e9705ce06abb0ab0d6174c7c10799',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe423429bb7247a808d50d38fa7419d9b4177cd5c57b6254f045f19091b68ce55',
		securityPoolDeploymentWorker: '0x253c1a01ed8d25baa3e957b1187ea77291f9ad3d098d9e330fcb71be5575263b',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xf74409f5f5b616880ef0b89969e14b4146478aa3d87ed3ca9c6adad879231304',
		securityPoolDeploymentWorker: '0x096a292003873c1b8c08bc765b33275f5ef0803247505c7fe6eff04146289e35',
	},
	deterministic: {
		securityPoolDeployer: '0xfe51088cf2bb79224b31b1779a2e2fd0c6017478d6fe45b65894f99075a6ba2f',
		securityPoolDeploymentWorker: '0x8a2148f8d74674c86ad245af3a22751a8fdc1d13ff099d98a916eb8100f9333c',
	},
	mainnet: {
		securityPoolDeployer: '0xf4ea44a42991d1b1b05b5d7dc5e15161e6a06b09925cd7387ef22276c6e1018f',
		securityPoolDeploymentWorker: '0x859e2224ae4ac18bb524ff38c81144e5dbaf62dcacb5b1481217720fcfd31289',
	},
}
