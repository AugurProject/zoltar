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
	securityPoolCapitalRepairAuctionDelegate: '0xf73b58c41d17ab66f24514c1eed0d0794d29ed8ff5ffa44935f0e8781139585a',
	securityPoolCapitalLifecycleDelegate: '0x58f94634349d2cd771cf150d2fad03882119fc4ae520d2b7e7e5f6521debf2a7',
	escalationGameCreationCodePartOne: '0x918ed8ca0e46f620f8e5aff4063d1e1de4da749502123d0e1f47c3a4c2b5cdc2',
	escalationGameCreationCodePartTwo: '0x6138e84c51b884fdab1d23db44ffbf5a474dab530fa0434b000eabf4093b3f99',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x1406dd540abb866bf55ffef7cfa688d0730d226a8d18a1a0d61d8991b0e6bd2f',
	securityPoolAuctionCreationCodeSecondChunk: '0xd7fddc045e1041c82ea4d45f69e8770d8e1162e047e2e8f710c9ff96feab7483',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xfe6341a0415e785006b64be4ea683c777d013ca878819d338c5eecec99c33358',
	securityPoolCapitalCreationCodeSecondChunk: '0xf65531d186dced791af400f58e46145a2ec744c0aa0e2371700168ffcee5ab9b',
	questionLedgerCreationCodeFirstChunk: '0xcfdbbaf98314ab74ebb4ab6ec8091e067c60b73c568c75056e47be0e6933c441',
	questionLedgerCreationCodeSecondChunk: '0xb353ebf6bad46a3be037a70eb822161dc3860ef9647bc0e72885ecde73820d5e',
	securityPoolForkCreationCodeFirstChunk: '0x40c7cef4d199a8f27c99c52c4318a53402e1d247a698b6c658c59ff18caaf620',
	securityPoolForkCreationCodeSecondChunk: '0x32532e0b84fd8995a82f2ca35efc0ba4fb231e2880575294fcd55fa2ed945443',
	securityPoolServicesCreationCodeFirstChunk: '0x5a23a1366ced1bd54880839fb063ed643c981a16af624cd0f9b7dc0e0c022354',
	securityPoolServicesCreationCodeSecondChunk: '0x290598820ca3de23b8a381d8a9e16e91fa91e6959d3028112f294647798c7224',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x88cbb0a074ce2c4313dbb1ff1589f22eb6109403f1d96f1b605a6b503e6424f5',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa236e09df73dbd534d358a136f2ec5795d78c7fd41900fbcafbb7db298c4a7cc',
		questionLedgerDeploymentWorker: '0x31b2be19025746f1cbc3d49cf79e22ef2072c1172cf83dc7f7d6e1c26466d332',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x344fafe1722f3603b9212d542988d9ac7a9f1ded0501c1251845f63c06c69262',
		questionLedgerDeploymentWorker: '0x4d33709a9dc976c0fc2f6e96306d80fd181cb0dfd9445865a7f5928e6bd13503',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x56c9dcba7de1c3d07e7448132a7c9b55b9eaf1cfae50724b3b8d08c1af17a171',
		questionLedgerDeploymentWorker: '0x9ee10fb9d7cc5b551e2d6a3c6c78851d1fac7f7fe12383c2bafb869c45caa8d1',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x9996f227fcf50b35851e1dc4c26cecb3a20f2392ec89bb3aaff64af533e18b44',
		questionLedgerDeploymentWorker: '0xf4efa377b9cfa8aa2f40b0afc5658ff186452f45a1a4bab8d0a904fcaecf8165',
	},
	deterministic: {
		questionLedgerDeployer: '0x716c8a32db3797f6358f82b7f38a485742a8f5348a36a84ec89ae57d8e19dd96',
		questionLedgerDeploymentWorker: '0xeba774fdd9d01cddccf9c1460abd8f511eb0437d4451bb291b1d75492ef094f9',
	},
	mainnet: {
		questionLedgerDeployer: '0xdbaa0b08b906d9650fe56c1e20643c3389aa207940bc6ccae55d84bdb16c2045',
		questionLedgerDeploymentWorker: '0x1e4b82dee17a00384faec74a0cbf1fe7316c1c7b01205aaa941574c8df83e6a6',
	},
}
