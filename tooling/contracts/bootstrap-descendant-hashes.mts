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
	escalationGameCreationCodePartOne: '0xb16eea48e4d518071fbac37843d23aadc374369da40fbdcbc6601f2fdf22fa65',
	escalationGameCreationCodePartTwo: '0xc81c8682f60dbbbc71e4c41e13249d3f4feb6c623ae1c52655b504befd611033',
	escalationGameProofVerifier: '0xd004b6731c452a89baa553168a2975e5f69edfc86b744446b7f7ff6538293933',
	oracleReportDelegate: '0xefbc6256374267222b817f248cd7e59f1c0016aad69d03c028bd6aac2df5799e',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0x6a60da50ae47abfc241f571872bce03a7c3fea82a968b48fed604f05f7f4527a',
	securityPoolAuctionCreationCodeSecondChunk: '0x729381bfc8a21b1aea0911ee5deb22a4f45faf105b2aa31212a66b0f26a3574f',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x584e156b68a4105d9e25cbc675978e1729961b474514e63457a92615d53efb48',
	securityPoolCapitalCreationCodeSecondChunk: '0x073c607d599e665da0d2c65edb905ba8bb0ab82c31372a30b065585116917177',
	securityPoolCreationCodeFirstChunk: '0xa000cc7f9bf499633704f00cd69e7b81dbc484daf15f04d751bc6d683cfc416c',
	securityPoolCreationCodeSecondChunk: '0x8e2a373091e94120de726c9b8a7465c1e318d6e837bde3ddf7788b34c5fe6592',
	securityPoolForkCreationCodeFirstChunk: '0x77b1900741c534724227a5911a8fd7f293aff53efd362ab83c449a8ecfa4c182',
	securityPoolForkCreationCodeSecondChunk: '0x674f14542e9a5476f7f39b6842a75ce215a3edfc9c3d8763cf1d1e5806890345',
	securityPoolServicesCreationCodeFirstChunk: '0x1399a2ee3bb5b03e07c1dd2bf316de033ca784f41798ebd6902fa2079fe94256',
	securityPoolServicesCreationCodeSecondChunk: '0xc6e12f8a0d84e101c2af9d724e454e0c536c6d63b3582db1969c6551cf65b703',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x03cec1fe204e63243840405bf003a7dfb90650fa229ec745ad6712e3ace0c2f0',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xb65d5a94b458786fe4722ead992670fc815d2320e0843761e77cf2b6ca84db0c',
	securityPoolCapitalFeeStreamsImplementation: '0x1cef956a3b79bfcd4475d967b983dc7eac2ded6f04d51c2a8bc5417895f49a01',
	securityPoolCommitmentIndexImplementation: '0xb429a1aaa4a16e37783787d8713afb1e6aa623eb154c752b4768b4eb9705278e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd4df409278543be347d38559eac4ce5f5abcf958febb2342637f1a98907e590e',
		securityPoolDeploymentWorker: '0x6e341c44a8e8df1b08ad030eb5eeef79a14577c2ba9bae70665ec04cc31047cc',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x56936a785438c42da139546e33b5557d012727c88b3a9945e2a38633365125a3',
		securityPoolDeploymentWorker: '0xe9695b711c53f139b34dca2ae04bdf48d1f37f09ee939677f1b2e41ff8135e58',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x66d38cf46b44a0d48113b3dc2a0ab339d1e39a5c262924a693fac85966e85e04',
		securityPoolDeploymentWorker: '0x58a0a33df5a1ac269e9f7e647ea3de807cec9efd4ba6a2422ded392a25168dc7',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x08c6e6b41ccbcd3d892a75355157178303c2505e7fefa3ca08aa959aa785c4ea',
		securityPoolDeploymentWorker: '0x66715ceb432ce53ca3b9246d535256c72324a5599c414bae4cf37a5cda9b7f8a',
	},
	deterministic: {
		securityPoolDeployer: '0x1c690f6deb7e635edc49261884be7833b7ca372752b92133350bcb74ffa497ed',
		securityPoolDeploymentWorker: '0xd4a42f96cc267c410360df8d5e0143d238eb33ed081481e7cbf1143661458a02',
	},
	mainnet: {
		securityPoolDeployer: '0x506b30b6be088da2899d0ccf0b6aac99f51db7642713c022ff02edacc4ebfbc3',
		securityPoolDeploymentWorker: '0xb08bbce8446b1f12c16c2815af173f97655a856a0f5e3f76cfecf8e3c1ba8e47',
	},
}
