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
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x48b3836f1b6bb205870feaf5667fed685457b2eee79b3eadc71a12270930970e',
	securityPoolAuctionCreationCodeSecondChunk: '0x3601780d2b0dade60cdf52f2fae693e20e5d6b3bac6a73e01b3f5ec22e8295ea',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x04f0a738e69c8e2e00edfc79cf6a8b785ec46d345093bb1fb68b7c4c574c145d',
	securityPoolCapitalCreationCodeSecondChunk: '0x3a2cb3caabdffd3af0a57559bb73537c7f665365791aada4cd9d9a8221e94705',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xfc95e05adc7e6d6e5d922cf2460773ab350e651c16443416d1c8b17d0330e5b6',
	securityPoolServicesCreationCodeSecondChunk: '0xc0da9cfd3ace1cbdc181cc642f00d4aceea3e7edefe636caaef17871664cb23b',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x069ec7f03aa297128c743d995cd8c0a981491b184a7c875f3c13205df769d38d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x61c7b2e841bc32a35acb904533a64958813ec08c12d80796db73553114af3633',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xfc7537a2e1299aa377bb43766a9249f6229ffb3bcb101aba7f5301496af046bc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xb45f90383f7317bced705d34c2a304522aa5cbc07ad9c7edb214da5e124ea26b',
	securityPoolCapitalFeeStreamsImplementation: '0x9cf080d4bf9b5c9b4ca7503ac5b481a79783007392e7c399087486d385dbc487',
	securityPoolCommitmentIndexImplementation: '0x7e76667a83cd6a522c854eeadd99d4f905a547aa0b30cd5a7494b25bc14da4e6',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc32b2761ee069c31783e8cde685d784c1d1a965e4a88046ef8af11db1362e491',
		securityPoolDeploymentWorker: '0xac677fbe9853e65759863a48477bf1464f34a7bc600edeb1978a47c2439d7c1a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x1339f061921485465d31029a0d6a54036b367d6b47816975b0fbc40a0d725174',
		securityPoolDeploymentWorker: '0x44370df6db0081f6c33e0195f0c1b068287cab35c2837b62c1aeeba3bc1804dc',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x93818ee70f2ac1f4c3f0c344eade13fb00e95c83b281c79cb452ac56e75923be',
		securityPoolDeploymentWorker: '0xa4997207cb6f7cffb5fb189ea8baea6c0f20eb19de499e02939394bacaaa2172',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xbb9db8b5b4224916d0c0ac3b27baa271d4c28d66456e3769287e729cb6034db2',
		securityPoolDeploymentWorker: '0x7a236b907119c56eb3f83a3be1f29feff53eaa472587418f80ca85a4a43474b9',
	},
	deterministic: {
		securityPoolDeployer: '0x8a5c94ab01088200b02bda5ebff5ec2757201ccc6b4cbb2d6b8d987f5c1d8a34',
		securityPoolDeploymentWorker: '0x2568c6108d3bfad95a0f83ee1dbaacc157ce8cae7e0f6af5acd775a8b74809fe',
	},
	mainnet: {
		securityPoolDeployer: '0x105d172bc305895d48b10c8af778dd325a08d62ef196c543e8860a85ede09a6a',
		securityPoolDeploymentWorker: '0x8a20b6d4e7d3e60cd1ce0a4120b3d1c4e1e077a2dc533a02f2fb680abf66306c',
	},
}
