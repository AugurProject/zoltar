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
| deploymentStatusOracle | Deployment Status Oracle | `0x7F6E3Ef2ED7Aaf152bdbe635Dd2c368f3626057a` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0xAAd99d4Cf6b0A03C871b8410fFBf8a2141Ee9D23` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0x6b5003e3715D5Bc8C753ca9822A0c550801B1fca` |
| shareTokenFactory | ShareTokenFactory | `0x872c1e44121E518B80f676A6EB26239A50d70801` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xA44b361a1fc8491AE7a84EE2bD0c7433b46A16b6` |
| securityPoolForker | Security Pool Forker | `0xf3cbbfE6d37D97e87a68d68AD20f109307cBA71A` |
| escalationGameFactory | Escalation Game Factory | `0x3E2EdE14087Ad0b91960081eDAfB0A344Ec0Da7d` |
| securityPoolFactory | Security Pool Factory | `0xd16Bf2Bdd64B79dF1c34CD3ABC6D101d8866B159` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
