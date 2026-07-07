# Mainnet Deployment Addresses

These values are derived from the frozen mainnet protocol config, current contract artifacts, the proxy deployer, and CREATE2 salts. The machine-readable source for this table is `docs/mainnet-deployment-addresses.json`.

## Frozen Protocol Config

| Parameter | Value | Unit / Meaning |
| --- | --- | --- |
| forkThresholdDivisor | 20 | Fork threshold is `1 / 20` of theoretical REP supply. |
| forkBurnDivisor | 5 | Fork initiator haircut is `1 / 5` of the fork threshold. |
| initialEscalationGameDeposit | 1000000000000000000 | `1 REP`; constructor-set starting escalation bond from the frozen deployment config. |

## Deterministic Deployment Steps

| ID | Label | Expected Address |
| --- | --- | --- |
| proxyDeployer | Proxy Deployer | `0x7A0D94F55792C434d74a40883C6ed8545E406D12` |
| deploymentStatusOracle | Deployment Status Oracle | `0xc24b25f9d8aC4d6712e5597739F38d322a16DC1B` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x5E4c12371fd630C7c83c7fB756135BeEbf9E1F24` |
| scalarOutcomes | ScalarOutcomes | `0x375993210Bd295D329CaB7EeD4CEE17C73493af5` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0x3fDE26F6C206DDc4991087FCeB5f13EC9f6F3E94` |
| zoltar | Zoltar | `0x5FaE7E52e81250Fad0fCF05db42eCCCB3B0Bed95` |
| shareTokenFactory | ShareTokenFactory | `0xD10481CD662F158a47D7EE3865469935170FD413` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0x04d28664553c92cBdF047Eb4FdDe14BbF0C807F9` |
| securityPoolForker | Security Pool Forker | `0x2C6A96471B2170758D4496894C700f0F2DEB6E9b` |
| escalationGameFactory | Escalation Game Factory | `0xc70CE6df4E6B602a3E1E1283ecAB23d807B3137E` |
| securityPoolFactory | Security Pool Factory | `0xE7542f757Af3b6058E9e919dfC1aC75c942E4831` |

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
| escalationGameProofVerifier | Escalation Game Proof Verifier | `0x49c15EE7a02aE413dD2c8E99732136a4Dc36698e` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
