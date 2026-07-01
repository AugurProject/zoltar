# Mainnet Deployment Addresses

These values are derived from the frozen mainnet protocol config, current contract artifacts, the proxy deployer, and CREATE2 salts. The machine-readable source for this table is `docs/mainnet-deployment-addresses.json`.

## Frozen Protocol Config

| Parameter | Value |
| --- | --- |
| forkThresholdDivisor | 20 |
| forkBurnDivisor | 5 |
| initialEscalationGameDeposit | 1000000000000000000 |

## Deterministic Deployment Steps

| ID | Label | Expected Address |
| --- | --- | --- |
| proxyDeployer | Proxy Deployer | `0x7A0D94F55792C434d74a40883C6ed8545E406D12` |
| deploymentStatusOracle | Deployment Status Oracle | `0xF8690e1E90f4315b84766ba5053A4b5d83373180` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x71761Fa073a1b5FA49154637Cf61b85172E8cA15` |
| scalarOutcomes | ScalarOutcomes | `0x375993210Bd295D329CaB7EeD4CEE17C73493af5` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0x3fDE26F6C206DDc4991087FCeB5f13EC9f6F3E94` |
| zoltar | Zoltar | `0x5FaE7E52e81250Fad0fCF05db42eCCCB3B0Bed95` |
| shareTokenFactory | ShareTokenFactory | `0x3842F9Db89Fa10694FEbf31E1885d66d1bF24443` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xA900a6445b0C80adbE4b8761735073df12397477` |
| securityPoolForker | Security Pool Forker | `0x6B35e09cAFBd67669625063756747374B0F2DF69` |
| escalationGameFactory | Escalation Game Factory | `0x85494737031ee5aB6f3A0b049ab890b90dD27687` |
| securityPoolFactory | Security Pool Factory | `0xE8b0D124b502E50Cd4BDbb784EF637A18258eb56` |

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
| escalationGameProofVerifier | Escalation Game Proof Verifier | `0x7c18155F93A358633B1b8721f96ab6eD54FDbFb5` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
