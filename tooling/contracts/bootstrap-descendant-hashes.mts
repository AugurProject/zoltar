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
	escalationGameCreationCodePartOne: '0xb03741d572dcd97ea1ac6eb6c611d35cd66a5499f327c6f70dfdfe69e33831a8',
	escalationGameCreationCodePartTwo: '0xed97911f561a58188bd026ca7a916588c727a9fdcde2e1b8d1395967c846edfc',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xefbc6256374267222b817f248cd7e59f1c0016aad69d03c028bd6aac2df5799e',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0x0ba666c684d0873b7bdc33d4f5987bded5d741a2e8f2c790ef2b1a0e34197bea',
	securityPoolAuctionCreationCodeSecondChunk: '0xabadf281d89becba28e916db6b25e21983f8ca09236318e9b2ec75c9920b43c9',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x6b9dfaf589800052661ace577daf2ac7e7bb2343edcbacc57bc8c8c8c74d766a',
	securityPoolCapitalCreationCodeSecondChunk: '0xa72f84ae7410e9df3c92f8ed5a29c6081156c5b20d4a1093abf5bb8a8335627b',
	securityPoolCreationCodeFirstChunk: '0xa000cc7f9bf499633704f00cd69e7b81dbc484daf15f04d751bc6d683cfc416c',
	securityPoolCreationCodeSecondChunk: '0x8e2a373091e94120de726c9b8a7465c1e318d6e837bde3ddf7788b34c5fe6592',
	securityPoolForkCreationCodeFirstChunk: '0x03d4635993dc0b32cb5b36ca808319c43af1d80b15e1a65f8191d59c4cd90802',
	securityPoolForkCreationCodeSecondChunk: '0x1b3725b94aca0348ee54a973d2a92cab3a358509ade7bc9e1be778fa43f01d60',
	securityPoolServicesCreationCodeFirstChunk: '0xaee57462e658f749ba406285378bfa867b99f47a065f6dfd9915e9f0d7aca629',
	securityPoolServicesCreationCodeSecondChunk: '0xf93a3f7da8339f41d519c981f9ab07b5b02f511d1bbfe14f404e016604bbbdbc',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x216046ab4f170cca65a741de86284fe2a841312094de578984a3cd484de10037',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x71a949490e9b4a73cf9acb282ef85d11c253c327a8837acdd874a9c3a7ddaa91',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xdd150cf02c92f7e73e13e81e065d617b2bebc31dd9712478df864aa3a178d235',
		securityPoolDeploymentWorker: '0x3f04e19d8ff0a571c6530b78d312c491e9f9dbe309fff3de8d022504055e1fae',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xcafd644e4d1f65642f1e2577ed8c590c380c1843ceaef3a4ede7234ca762166a',
		securityPoolDeploymentWorker: '0x8a569cbb944da2048185c883bb653f3f11aee4335f563ac98dbca697d6010b9b',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x659768b88c1e8a24a645ff8cb305e5ec57656309b2eabb2be7ee227b615f38ed',
		securityPoolDeploymentWorker: '0x83a78c847b310745088df6928f39aeec3c054434a2fa531476c3c52554d3a9a0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x8af62417723f689b8f07bc6b94b3e58c5bebd73452f3b10a2b728bfc8d22daa6',
		securityPoolDeploymentWorker: '0x5f22ec8c32ab997f115e6ff551d5b35d87d1e8c88d81cc83214046a8b9a992a4',
	},
	deterministic: {
		securityPoolDeployer: '0x2de29e9e52f4a3ea3d624c518101bcdb4a9bc1ad05919501b12ab031f9d9088a',
		securityPoolDeploymentWorker: '0x36231ffa78e368818bc1ce6dff7c9d026c26b96ce319eae60770adeb3bc74c68',
	},
	mainnet: {
		securityPoolDeployer: '0x88cf5f8f85fa38e302040f862a0ef121d272e97b167d7a9af1b2083207c29dec',
		securityPoolDeploymentWorker: '0xd24a87bdbf3de777f02a20e5eddc300677381e61eb7e25c6f7a65b0081849473',
	},
}
