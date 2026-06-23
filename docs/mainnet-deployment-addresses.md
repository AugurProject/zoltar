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
| deploymentStatusOracle | Deployment Status Oracle | `0xf53C5906F9489cA8c5C4f9De268729C8F5e27960` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0xbA605970da511b08539bcC4F77B54CF1Cd72783c` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0x6b5003e3715D5Bc8C753ca9822A0c550801B1fca` |
| shareTokenFactory | ShareTokenFactory | `0x613E9D038B68f9646eaFe668a62b5c8DEF10a45D` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0x616622aBe02cB15Af9d4eD83B12F190A8C66e296` |
| securityPoolForker | Security Pool Forker | `0x7B9C22734196A3943562f3bbcE9f779dA99bF9d3` |
| escalationGameFactory | Escalation Game Factory | `0x8048069571e690E86f8A98A6f635f6521847E371` |
| securityPoolFactory | Security Pool Factory | `0xF84e04E61090930eeBE19604f770ac4C4A31337e` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
