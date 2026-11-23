import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the question ledger deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0x1f17bdabbdff2f2110ccbaaece91e9855f724389305b54595e302a4f6c238f9c',
	escalationGameCreationCodePartTwo: '0xd2d7fd9aa293d027bd67dae8117c98f95edc50fede0653fb35b77eeda6665cae',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x33063bf12bd481fcc9d88febf40e109bd9836355fafe2e9bac1c0fb1d7c4dc6b',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x9de92ef573ade6c6a9116be69c4b1bbbfd0ea01a198c079d8cec6c84894164f5',
	securityPoolCapitalCreationCodeFirstChunk: '0xab05d8188b83b3d0f7f8fa7e042d78643c4510681d1ceef31fdfe4c65bd3a866',
	securityPoolCapitalCreationCodeSecondChunk: '0x4684446c8055c211a88eb477e63d3a2be2883b62c8a789dd7af8c73d393b812a',
	questionLedgerCreationCodeFirstChunk: '0x0f5eff92e0a7d0dc52e49ba21ad42af63e8e1a15238407246bef054f01e2bbf7',
	questionLedgerCreationCodeSecondChunk: '0xbabfb855c3f69592c03179c000fb2232453057149e4ce86ff4907cb8609a2a41',
	securityPoolForkCreationCodeFirstChunk: '0xb29554e4d905d71aef02d60ce0e0e3b3de3a8b5ab2eebadfaf6d078917a3bb99',
	securityPoolForkCreationCodeSecondChunk: '0xc97d84d12af29c8d051ae372923ea5cf58ec9952fd2d1f1e3c5792398933cdde',
	securityPoolServicesCreationCodeFirstChunk: '0xbe3cd55acbdc42fb6273a853b96154340710ecc5c914f3102b2d8c202245a30e',
	securityPoolServicesCreationCodeSecondChunk: '0xd0cee73c3fad5a64adaec34717f2627472d01153772beee21b3ddf76bdd23abf',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xee7264453eeba3aec213c256e531e12161fac344ea0005884d5dea6091d3bde5',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x5dbf4240c43ec3452cbd193db8905b2e8bb56297568686d9c03b019af088ceb8',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xac1ce17939c19bb3c1e1e5b823e5615e45cb5e4a766d1a2b0bc519f1a3062073',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb8b9d18c9b9776bc4bce9ecf995033b7c879f6bfbda579f3eb2267705330157c',
		questionLedgerDeploymentWorker: '0xa3b43ab49e9af4f8f4f2b4334ca6475f9082862f3830245133a86d9466216d29',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x3e53c0fac0a306f57879a30f60b90e7556229c809b5c8dd2208d00233fd6aed0',
		questionLedgerDeploymentWorker: '0x5649d0ee3ed8ca5b078f1bac794a28771994871cb2c4fb9aebcc06d1665b4474',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x00b83a01daa1d729426e694116c53c501895a27ba6148fc69a477fdec003fec2',
		questionLedgerDeploymentWorker: '0x993991fd4ae34b48d2f183c9b59e5ee0d0c25a8d88f33375512249d44f09b65c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x5cc2ae66578e05d411b8d6680c8e6278abd9a69a1be3f587510e7190c41691a4',
		questionLedgerDeploymentWorker: '0x5a8454e224728afdf49bf30f900bd9ebd67ccd3831c2d836977ae8a7dd41f285',
	},
	deterministic: {
		questionLedgerDeployer: '0x7fdb2443723d5a542d2fbf48ef64ea2af88819872775738415f68aaf4a55a3a7',
		questionLedgerDeploymentWorker: '0x776e0bec226bc6ace5b871f465f48496bcca1aa204c5a57f0b543d04836dbd13',
	},
	mainnet: {
		questionLedgerDeployer: '0x766525ee8536b597c47fd022bc78657405b3f95769ff8a9f059b5a738931b1f3',
		questionLedgerDeploymentWorker: '0x2268bfd9330c6c29891b00cdbaaf78a8634ddf7c54bbc715b38e68aa1b67f57b',
	},
}
