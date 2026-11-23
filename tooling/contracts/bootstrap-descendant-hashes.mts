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
	securityPoolAuctionCreationCodeFirstChunk: '0x6cdf8df97f97d60620cabb20ec33b5390f5825e35b4d40fb43877eeefc4e9b17',
	securityPoolAuctionCreationCodeSecondChunk: '0xf611057ce2fcdd1f4bdd3c87d451b7e5ef207b2e8ded1585d7c77a4cd6e8a32d',
	securityPoolAuctionVaultImplementation: '0x9de92ef573ade6c6a9116be69c4b1bbbfd0ea01a198c079d8cec6c84894164f5',
	securityPoolCapitalCreationCodeFirstChunk: '0x2450d09492b51353db2af5c158b4ee4124b4d0f5a3cd87bcaf2b6fb9497c9226',
	securityPoolCapitalCreationCodeSecondChunk: '0x95a12d9cce85a4104b158ce5fa21d462d92f498e8e90361068da690fa5fbcb28',
	questionLedgerCreationCodeFirstChunk: '0x0f5eff92e0a7d0dc52e49ba21ad42af63e8e1a15238407246bef054f01e2bbf7',
	questionLedgerCreationCodeSecondChunk: '0xbabfb855c3f69592c03179c000fb2232453057149e4ce86ff4907cb8609a2a41',
	securityPoolForkCreationCodeFirstChunk: '0xb29554e4d905d71aef02d60ce0e0e3b3de3a8b5ab2eebadfaf6d078917a3bb99',
	securityPoolForkCreationCodeSecondChunk: '0xc97d84d12af29c8d051ae372923ea5cf58ec9952fd2d1f1e3c5792398933cdde',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x129208ee27758e653089d3a3dcae76b1cb60a3b79e9d61d40f259629b8e4ffcb',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xfc942acf17b0e5ac92ced4550ffd7f39a7de711efb5504486caff1d0937e4c8c',
		questionLedgerDeploymentWorker: '0xda595a897170a7ee9f46c0b805b002d0d286fc1259326d6b87228078c23a6ad9',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x1dc1bf89bdad2c6deca79cd94a7847a59b52ac9b03be03d7c94f7b80b893f78e',
		questionLedgerDeploymentWorker: '0xb4e305cc5538f98c18b00d617ed0c5ba6e7285d87bd6d0824d9599298be9a02d',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xaf3ff6cefbe7e57d52f2195316d76f9f272d5809f751226dd50a379e89fd1e3d',
		questionLedgerDeploymentWorker: '0xbb81a66eab88840b7582bcc7ce2d865c8bebabb88f185198aba7fdc7962de030',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0xa5e742b272817dd5c01c3a4ea05d1dedd67949655d2c7e5bb407e17c49544450',
		questionLedgerDeploymentWorker: '0xe33aa2b33578fcdb686197bcb506a4c06d12a17175c7aaac5b94d569e6f289e3',
	},
	deterministic: {
		questionLedgerDeployer: '0x92d08901b3f3e5b9a304a66b5a2bb8fa989670a1891ebe294a3de539f8b99480',
		questionLedgerDeploymentWorker: '0xd60f4991120594d9c181b590d3494477b4d7e80181b18973285e1053caba25d0',
	},
	mainnet: {
		questionLedgerDeployer: '0xf174bbc80a082bd3dfca9fbe833b385d0f26af403327839725fcbfe952d760f6',
		questionLedgerDeploymentWorker: '0x1e13c68cb0a8650e02e1450bc53a420b3d70dc2d6ca1b368f46ca26ce5dc1c27',
	},
}
