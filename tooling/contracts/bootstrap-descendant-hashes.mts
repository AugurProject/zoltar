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
	securityPoolAuctionCreationCodeFirstChunk: '0x1543243e0d13bed0034c3611cec8c18b8f20f1f4e8cc4f1496dce189f81a3f04',
	securityPoolAuctionCreationCodeSecondChunk: '0x97b91c4a6ecfd2857fb61dea7397a6e9b5f8662537e34caa46fbd680deade149',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x9e28f13d3c1b1cfbba79bdd4dde287af09cebff546cf17dbc404b873d5f84a25',
	securityPoolCapitalCreationCodeSecondChunk: '0xbc65dc1f9964c3db3debb3efa8332d9d67f4d280bba5602c24bbae346f4bc0f8',
	securityPoolCreationCodeFirstChunk: '0x8aba1104eafede1197c1245fbacae1eb6ab61cb36297911671d850010cd0634e',
	securityPoolCreationCodeSecondChunk: '0xfb34bd59c76e86042d99afb23d82c0c1a36768cab54f00bb4ea3999a0c4d5f9e',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xd2ce8081f6ed49febe25629e8e9f3665ca76483c79ac89c01f957e0637ab0ec1',
	securityPoolServicesCreationCodeSecondChunk: '0x81d2df929c3e0842a0ff47dfdaf38539743dee407f2dc3de5d7b45f4563b4fb1',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xbf268c22a7bf891d53535e102f6cc2540b0aa5ae1884659ffb410a2206db2eec',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x7aee15d7c9a2c3a9ceb0e456ea93a0e5328f9c6d4eaa7cc7bae8c1a41f95722a',
	securityPoolCapitalFeeStreamsImplementation: '0x9cf080d4bf9b5c9b4ca7503ac5b481a79783007392e7c399087486d385dbc487',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xe57afb861bae328facb591ca3109cbbfa9d2a4c5ade76fad7aadc514010c98cf',
		securityPoolDeploymentWorker: '0xf39128fb52eee62b7beb5bf69d88bf03f76eeb4e0d4b1c73b4e97016832caca5',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x4b87f573291b46ae86bab85879bf6c0e653ecc625308a90473c115a37bbc1e48',
		securityPoolDeploymentWorker: '0x8b324e9c02c48a2aa2ef390c78c2ec1c3d37db982fd3f4906967dd0f2a776b30',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc3c018968e4bdbdf36f976542f4678131236998147e3a1ff769f2ea4ddfcac32',
		securityPoolDeploymentWorker: '0xf5923b7e99fc00d4f92603395b979908c7610886617d3041ea60ea1d8ae7b0ef',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xa6bd836f03eae23a994d557ea0acfe1ee5235b4e63eda4de0986ccbd855b50e9',
		securityPoolDeploymentWorker: '0x6ea994a90b5786b6e73fc52f468301299bb560250e42ac1ae1f0777ec2a318e5',
	},
	deterministic: {
		securityPoolDeployer: '0x3657260ebde63031ab6e9fbaaff0a75004fac21e04d78ed5063cafa78689c0f7',
		securityPoolDeploymentWorker: '0x9fdbbb15b83e51d05772c1c6f0658887556eab700b454dfbda37ce42e2bf9db5',
	},
	mainnet: {
		securityPoolDeployer: '0xb74495190202de00011161b574af361c5d53db09384e55758da83788c3f30363',
		securityPoolDeploymentWorker: '0x7a827286ad7a65054658ee8844187b27865d62571f9d684f5badb70dc0eaafe4',
	},
}
