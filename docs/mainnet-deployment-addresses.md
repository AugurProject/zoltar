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
| deploymentStatusOracle | Deployment Status Oracle | `0xAF8E1CEe3F802C36C148452DC15173b8758743E3` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x75D2FA67694b18b68DeE15583D65cbf32820Ab1F` |
| scalarOutcomes | ScalarOutcomes | `0x375993210Bd295D329CaB7EeD4CEE17C73493af5` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0x3fDE26F6C206DDc4991087FCeB5f13EC9f6F3E94` |
| zoltar | Zoltar | `0x5FaE7E52e81250Fad0fCF05db42eCCCB3B0Bed95` |
| shareTokenFactory | ShareTokenFactory | `0x2A9f77B1761778aA56dDd5d60aC7d97ed55D2F2D` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0x7F0039e5c5E018654Ca3f78D39D7F5dE41B28A8b` |
| securityPoolForker | Security Pool Forker | `0xa31f619604397d72214Bb99d60a022eE41010E44` |
| escalationGameFactory | Escalation Game Factory | `0xC8171161be712C32eDEDbc8Ad8f301E24c555b3d` |
| securityPoolFactory | Security Pool Factory | `0xDa8b6fDa56FF3e251934F537c9e1F33Ff467BBe7` |

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
| escalationGameProofVerifier | Escalation Game Proof Verifier | `0xBAec216F3D1Dea9E641DD78afb261c83a1Ab5Fc9` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
