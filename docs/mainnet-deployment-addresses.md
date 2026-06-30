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
| deploymentStatusOracle | Deployment Status Oracle | `0x47ea2ba57835b4675E30caF91f790dA6657D8DD1` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x75D2FA67694b18b68DeE15583D65cbf32820Ab1F` |
| scalarOutcomes | ScalarOutcomes | `0x375993210Bd295D329CaB7EeD4CEE17C73493af5` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0x3fDE26F6C206DDc4991087FCeB5f13EC9f6F3E94` |
| zoltar | Zoltar | `0x5FaE7E52e81250Fad0fCF05db42eCCCB3B0Bed95` |
| shareTokenFactory | ShareTokenFactory | `0x0F0beE207Fb2f7d0405fBE5835e95E4C5FEbB066` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xcfe4FBf16d694F87923dDE7c6b2468fBF7AFa7A3` |
| securityPoolForker | Security Pool Forker | `0xa791c448f4A194F461A17eC35f185d977909865B` |
| escalationGameFactory | Escalation Game Factory | `0x1f1F4Ea3996E42175f81AcD54776102a39aD2cbe` |
| securityPoolFactory | Security Pool Factory | `0xB5A0cD79c840Ffd1131dE95066801971343E96D1` |

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
| escalationGameProofVerifier | Escalation Game Proof Verifier | `0x2dB7Dc12866Cd17d968471d4d30E64EAEA32FC87` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
