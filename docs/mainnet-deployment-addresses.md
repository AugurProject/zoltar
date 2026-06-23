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
| deploymentStatusOracle | Deployment Status Oracle | `0x39e5740e9b580cc9a0784DA7d75B31E4706Cf8E3` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0xbA605970da511b08539bcC4F77B54CF1Cd72783c` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0x6b5003e3715D5Bc8C753ca9822A0c550801B1fca` |
| shareTokenFactory | ShareTokenFactory | `0x35aEAa2C0d7490646f0B43bEA33B82532f4fD685` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0x286b954175C2BDFC5cb79D95d125fA94Bc94C32D` |
| securityPoolForker | Security Pool Forker | `0xEBD8420396369ba5B50920BCAeEf12aa87Dbbf65` |
| escalationGameFactory | Escalation Game Factory | `0x2d0f9569FD00F3AFaFca907aD5561fc28BdEbE4f` |
| securityPoolFactory | Security Pool Factory | `0xAbf66A4dF49C16e253e1C1748DF836B6D0D74888` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
