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
	escalationGameCreationCodePartOne: '0x885eb03f0fce370c1f678967777fa970ac0cfe73a0081f94a237f7efc6f90303',
	escalationGameCreationCodePartTwo: '0x4be7eaa430c026d674575cdf98d47b4a6d7a8bb59a49a2379b3e935896d13e70',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0x48b3836f1b6bb205870feaf5667fed685457b2eee79b3eadc71a12270930970e',
	securityPoolAuctionCreationCodeSecondChunk: '0x3601780d2b0dade60cdf52f2fae693e20e5d6b3bac6a73e01b3f5ec22e8295ea',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x04f0a738e69c8e2e00edfc79cf6a8b785ec46d345093bb1fb68b7c4c574c145d',
	securityPoolCapitalCreationCodeSecondChunk: '0x3a2cb3caabdffd3af0a57559bb73537c7f665365791aada4cd9d9a8221e94705',
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
		securityPoolDeployer: '0x8137afe298e91439c611bb4e194dffd8e2974837a4d7fd29e3cb5a5222cf10c6',
		securityPoolDeploymentWorker: '0xefe78cf3b1c965ea8282147c3efbbf180ad26cfe3e7a2cebd540f87fd4e753c8',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x135290375dee30a5d3e4f1da7f1a7a56113389c32419d2e055b9ac3c8fa87050',
		securityPoolDeploymentWorker: '0xb9ef1ac27752e1efcfbed39f0b6e71c88dae99a31f6a9b02e604be3afa156795',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x6b3ba56f3235937fcb6dce9d5640e678e7194f4dad48d7973fe59fcd81a10cbe',
		securityPoolDeploymentWorker: '0x6d50bc141154590dfbb52ede9f071b0ff73a950ef9143d371c9ad3de1d8948ef',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xe9a9772385a3139a1cff1215b440c05e397bcf4064bcba1babb0e423c213d2fa',
		securityPoolDeploymentWorker: '0x6c95d36d3f7833aa988a536c7bcfe7e7e33c3af598db75fcdae90ebf29878ad2',
	},
	deterministic: {
		securityPoolDeployer: '0x4b67e3c3d4fcc5b6900914b7df2425857ddfebc23aa1a0181dc362e04979a962',
		securityPoolDeploymentWorker: '0x1329d629b5d8225e66cfc516668a89ad76019535c45663e04425b7cec24da927',
	},
	mainnet: {
		securityPoolDeployer: '0xe7fc0ae2d29e007c524c6cfd0a596f6bc27c2867e1cbf644cd696147b9ad867c',
		securityPoolDeploymentWorker: '0x6b4c5608b55228eea3c4a94ee287e209a01000e44a879243f9571709713527e6',
	},
}
