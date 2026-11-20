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
	securityPoolCapitalCreationCodeFirstChunk: '0xc139bd946be035573de2677ed1928e35f90af59d0eedefcc32c19538699de94f',
	securityPoolCapitalCreationCodeSecondChunk: '0x7864359897cc9b4c87be649ef811d72f3623f01e7b5a5d4b4986350747cf0a2d',
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
		securityPoolDeployer: '0x892ee3b7ffb7c95bf70d0aa4b5bd41f8fe64984cd797fd6a7923b82e7c7c94ff',
		securityPoolDeploymentWorker: '0x0c0c9d00b536898da5d0103e29c6e6d638374c70943c848107d883c0afb1c3ad',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x13f32b8007f6465de05b42315ec6a806621d80e43bc3d424676dcd75c451d09a',
		securityPoolDeploymentWorker: '0x6a7f1763957429ada267567170071527618030529715e52e2f9bb52646eab480',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x028f264cc52b285d176de9eb3c6034d41b628462621a0c5cf0e1b25b91d9020a',
		securityPoolDeploymentWorker: '0xe667d03e99894cc92145e8578ff7704284bfe3e6d78c51ea1104459405141f83',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x5ac42bfcf2f64be787e8eab1e9434a49a264c66199b8beae6ae97ee9a78a11c6',
		securityPoolDeploymentWorker: '0xc4b30c954e1a3fba27434bad8da264eb42e30c6cc550e2ce4d605eb17a1cf4cf',
	},
	deterministic: {
		securityPoolDeployer: '0x057f6c6838a16a05b87d28d312ab18662ce7373f616a3be511560cbee8e4a2d4',
		securityPoolDeploymentWorker: '0xab357b20464a399e9073313b2f957b433fdd780cefc22a8a75a1315c7c186ac6',
	},
	mainnet: {
		securityPoolDeployer: '0xa7b30050fe2b10c4fa165de18ff69909201995dedff24e2e88068195a9c8e07a',
		securityPoolDeploymentWorker: '0x61adedd97d71fe5220ce3a98076243ae6adae02230840cb0ca962d828ed96d99',
	},
}
