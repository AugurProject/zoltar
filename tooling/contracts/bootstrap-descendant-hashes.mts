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
	securityPoolCapitalCreationCodeFirstChunk: '0x8d5baa8afc2c9350cafb03e05bdc662f82d8fdb8620949d7d7c47d4201734adf',
	securityPoolCapitalCreationCodeSecondChunk: '0x62ddfa30c1f9169442009ff5c08828fb025c2f74fb08a7d709384db7527fbc11',
	questionLedgerCreationCodeFirstChunk: '0xc5f6f4fce0c7cb1284dc8183524c90cbf1818716228be7ee7998fe42a8de3152',
	questionLedgerCreationCodeSecondChunk: '0xbb5ccbf5a4e880dd2ee9fdad9785c27c2d8ba16efe4c981d6d552da5a17bb240',
	securityPoolForkCreationCodeFirstChunk: '0xb29554e4d905d71aef02d60ce0e0e3b3de3a8b5ab2eebadfaf6d078917a3bb99',
	securityPoolForkCreationCodeSecondChunk: '0xc97d84d12af29c8d051ae372923ea5cf58ec9952fd2d1f1e3c5792398933cdde',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x5ff48a7081a18fc3af94aedab5b9ff4b7c388869f54d755181c56b948a2263ec',
		questionLedgerDeploymentWorker: '0xc3169d68724d9d682ab0a127a6166a1cb588fbad13e5126bc1cb64308a48e1c7',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x7fbf8e1c83c944d27381145f0fc18e924f754b432810396ef322267ff659516f',
		questionLedgerDeploymentWorker: '0x1844f5272d44bf18fed4c035a70c02b21a7626b413a885eca060d5b568872399',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x6964f28cf2c21388d8780e4419081fcd4af438b4884c63f84392d4a6bc4e03dd',
		questionLedgerDeploymentWorker: '0xf58ff51009b745c124cbe48148a95da5ca7c07529a31169556393257f35f6c77',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x246dfc12dbfd02f317e6743494737f9264f8a117b80dbd51027544d06b605c28',
		questionLedgerDeploymentWorker: '0xafad643510c5fdd085159ef2e8332a76b937ba2f76490778bb17cebb41cdd158',
	},
	deterministic: {
		questionLedgerDeployer: '0x45fd250020cc714113f96030d55ab1b2a57c492e67b9a794170076d95337df5d',
		questionLedgerDeploymentWorker: '0xd67d8eaf72591fc7281078d5af79b5bdfc17a92f5d9bc1118895ada6ed156e8b',
	},
	mainnet: {
		questionLedgerDeployer: '0x26ff63d46f7766a0551f322d6acc6d503e053fab2c67ffeea6a8ebb32524b988',
		questionLedgerDeploymentWorker: '0x9949315ecbb1ebc211bde293dd5912485f914b37dc23e9a7d5a4ef5c5d8e5478',
	},
}
