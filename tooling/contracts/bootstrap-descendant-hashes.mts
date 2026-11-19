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
	escalationGameCreationCodePartOne: '0xc62e53c4ff03611b706b943af98dc012ec41d7960bf9c7bb39cc794d243cde0b',
	escalationGameCreationCodePartTwo: '0x58f1102ef90e7e4b0816f615c5aae27047306034d44e132f0c1896b86c415518',
	escalationGameProofVerifier: '0x952e7fb065531350d379c8e2af2f3d0d3322609a5ef82b9acb61d1030f65237c',
	oracleReportDelegate: '0xefbc6256374267222b817f248cd7e59f1c0016aad69d03c028bd6aac2df5799e',
	priceCoordinatorCreationCodeFirstChunk: '0x69162fb9de65d0be10f739cfc2b63a461bf8ba8c264cad368dd089c156dba69c',
	priceCoordinatorCreationCodeSecondChunk: '0xdc50e4bf21c357ae88b36f64a808080cb695c28cc8d87393ce2f85119466060a',
	securityPoolAuctionCreationCodeFirstChunk: '0xe14dce81f72d820105d94465402aca250c41e702bd3516d472ccf95e55dcf0ed',
	securityPoolAuctionCreationCodeSecondChunk: '0x9fa08077fe6f1777d33a15c9239b2c5efc3985cff0231bc0ddce50af018a2888',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0xb1d444def6fd86999caaaca692c9e5daae72acb15c280fdd12797250d258dfdd',
	securityPoolCapitalCreationCodeSecondChunk: '0xa152e0c14b32ffb701d5b117a42db145a25e4ee04a980d898aafcb4d414ff694',
	securityPoolCreationCodeFirstChunk: '0x9a74d4b594d66e2ae596c87695f03a44fdbe4df8b4c66e10e1831370081bab40',
	securityPoolCreationCodeSecondChunk: '0x9d429eeb9aae54d2f62ef7e9b9dba4c0d5c270c9ae6be1836bdcc30f163bea56',
	securityPoolForkCreationCodeFirstChunk: '0xaf865aa7d492d33f8de535cc6c268e1dc86be493cc2e25d775d38f6de1207b77',
	securityPoolForkCreationCodeSecondChunk: '0x7425a3210edd9605670935a0f11df2c5827edd49b5a82aeba7f3164759fb501c',
	securityPoolServicesCreationCodeFirstChunk: '0xe1fa2920c0cd57f6d630f0fbf06f6aa59450455699da77ccf6c791fcf7dad486',
	securityPoolServicesCreationCodeSecondChunk: '0x1ba89b20cc678bccb3fc07c3a8954b3c2e0b81ed402e69220f03655b98169327',
	securityPoolSettlementBookCreationCodeFirstChunk: '0xeca24a606cc6bef597506b06cf42291a9a0c1be691bc1fbddc7444892f0a870d',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xb471ac33133d19d74ddbbe17d5d29e77f31e287f583f6d133343b964be44ba9d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa6ee6820fd922aa5d427a5b56e3981acc9c2be2a4b9d509984040828379d8713',
	securityPoolCapitalFeeStreamsImplementation: '0xc6b44c9b096d07ea645a68fdc536babfac70d5ab7ab15cfdb9f6590c68eb2dcd',
	securityPoolCommitmentIndexImplementation: '0x60b10e50fb7b4241c9c23ec81bba3b81bae22a7323ea40d869fc70feab4807b2',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xd77a84b9af7c0abdf972dada91c7f4a5421d39998c513e6d5cc912bcd89f1cdc',
		securityPoolDeploymentWorker: '0x9d9e9e35936c11c8fc32cf1a3f9c5b5cdc217cc91fa6b81775180b4836fbd49a',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xc4ab743581228e58ebcaa9a6d20ae039d1ab2ac43fcb0b7372bc1f4004b9d2fc',
		securityPoolDeploymentWorker: '0x30a4a1450268c85f1600165e2b3f5d221c09ca625005f1afedd4f0c835c536e0',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xab0ba140ebd6a7072a1d488aa62cca8646df9943bba504a7ac9efde72370958c',
		securityPoolDeploymentWorker: '0xdd27dd67e4ed2227e9a555561c4e348f065b3b106bfff68952b8f97dc63ca572',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0xcc102b0dae7a34ff3ddd23acb769916a500b54b2359ef97cf789842b287bb1a0',
		securityPoolDeploymentWorker: '0x8fb33432f3aea00e16daac99edf23012b9ebaf8367ec408e9395c13e686cee12',
	},
	deterministic: {
		securityPoolDeployer: '0x3170705ae3a959520ff32ae870c6f8f0757fa80184f327ce75b4ec8015e59528',
		securityPoolDeploymentWorker: '0x557045ab0c5be41d34a3db56eee292e9efd1ba41e3be55fc1ed53a17c7096e53',
	},
	mainnet: {
		securityPoolDeployer: '0xf95f0fb46365abc92abacb07f44e672184363bcadfcd793f850605c395c92e43',
		securityPoolDeploymentWorker: '0x1ee7d1c1b108a4462d7c0a8b0f2cdab5a129ec6dac37b8f271738aa3abda3438',
	},
}
