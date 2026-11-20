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
	escalationGameCreationCodePartOne: '0x37f2971f26b31101f9221b1c15edee692be6be2b99273e632fb23a9eb8ce57c5',
	escalationGameCreationCodePartTwo: '0x2972bf789d21803500aa23f920ffaafe3e6d01e2fa9b7a12447371afcc4ffc27',
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
	securityPoolCommitmentIndexImplementation: '0x053295b8a0ea2eb8602df08e4833e99a0fbcebf9edb0db8454df34948850239f',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc2f9eee40d4500265252504a4f40b4be3e33a7bdb587b595d54860e7593e8719',
		securityPoolDeploymentWorker: '0x0158075a163054bca7da16acfbb2a8c1d9be4d38f5ea82e2400e56afe1def698',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xa5988cf1b87ba534e7be2d129e88ca32d5aadd19d71b343483e58d9bec52a18d',
		securityPoolDeploymentWorker: '0x6495ec467f70a437ad6b2ab3401661c62821550074334de515979f63777c03c6',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xfa70dfa3973f2329bdb75f882e2c19e0e2d87eb2f3cb999b5283e279cd51d4dc',
		securityPoolDeploymentWorker: '0x81f338a2e3bebb17c8a94c247e8da1bc12dd5511b9fde6015e6237f4b9a6dfa8',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x97eba92556d6f322bbf54dbc570d4dee5c5550decc65218d85842e6e32a9e567',
		securityPoolDeploymentWorker: '0xb2e7d8207927326a95984cbf111d0e23ac8eb0661ec6d115651cdacfdd76b825',
	},
	deterministic: {
		securityPoolDeployer: '0x09cd17b98765164ff66378c11f40062fab41c90a313fd1d525baa8d149fe955c',
		securityPoolDeploymentWorker: '0x696127fee6641f4ad0472ae8de21aedfeaa808ebd4e3011cccea63107e2213e9',
	},
	mainnet: {
		securityPoolDeployer: '0x11442f69f6a04ff34842026b53f98aa52f75d00a66e234829455498c9dd3d6d3',
		securityPoolDeploymentWorker: '0x3b86b73360c5798a52be1f89b6b58a1fa8c41ba8a58fac4efcdaac3d58661764',
	},
}
