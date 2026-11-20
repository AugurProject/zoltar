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
	escalationGameCreationCodePartOne: '0x6116c6ff4903435516fdc47e2bc65997ce3439c692241726082558cea1d001a9',
	escalationGameCreationCodePartTwo: '0x2940e94907f5ba1389c1c88652d0100162cecc6443878f205d8ae868b0347214',
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
	securityPoolServicesCreationCodeFirstChunk: '0x384bc2659d7a0801fe796ec4306e5d47a191c823f2eda12afde1307e358dd163',
	securityPoolServicesCreationCodeSecondChunk: '0x765e6d5c39e19073fae9ce98a79fafc0820233ee64678a8eaf1305a6d8d31684',
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
		securityPoolDeployer: '0x9e1fbe74bc60f11f3baa05ba652139dcb4a6b846052180056aa39acf24860041',
		securityPoolDeploymentWorker: '0x0e8277a1f2c018d3a77fd6d0df1ea41aa2b82ef982c6969fde43daddf69efe54',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x730d481003bd65dced9bd0e3c89f1f06330e0a2d458bb9f77b771d9c1841845a',
		securityPoolDeploymentWorker: '0xa9136ddb720f0c5a801c711b475de7125f1f18f1d3ef12fa52e791c8886459fa',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xf4467dedc1c7427f656e3afb3581742ab09accdd2fe7206c201ed8e28a8e1cf8',
		securityPoolDeploymentWorker: '0x84fbf98d72875eaddbb015d53054d54e5e9fc395cc5df39864cc83b8f43f0422',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x010aaedf200bfd26c1c7145760195ca0965c98b950a35fe30242f688a5fc2fa8',
		securityPoolDeploymentWorker: '0x3dfbb3d87ac5b93f40e5115d05bd57ef52f0368557b6a5aa2ec34d298d1c82a2',
	},
	deterministic: {
		securityPoolDeployer: '0x9a974990ac0bf49baf73383435535a7c083e8611dc3e44330a32047558d471ca',
		securityPoolDeploymentWorker: '0xe0abf02e130cf5eed0d7b941d71ec154efe94e03bd96c47ec47d6c0797b69f4d',
	},
	mainnet: {
		securityPoolDeployer: '0x3329a509b775f0503dc2c6e40c19a2eb865a3c4a044dc41001df24c6f3ba7fb1',
		securityPoolDeploymentWorker: '0x2c811e532380c62829f4a12aa846c2e23be9d4aea7509d8909037e1861732b07',
	},
}
