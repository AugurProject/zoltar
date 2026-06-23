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
| deploymentStatusOracle | Deployment Status Oracle | `0x93828C6aCF06FCfD825eC327d210BbfAd7E14428` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0xAAd99d4Cf6b0A03C871b8410fFBf8a2141Ee9D23` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0x6b5003e3715D5Bc8C753ca9822A0c550801B1fca` |
| shareTokenFactory | ShareTokenFactory | `0xE78ef3c358973D9372a0E0E2cE56E2bcb161Ae45` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xe21F0e1Cd36BDba08f08b53FFE1F89e3E840c80D` |
| securityPoolForker | Security Pool Forker | `0x1d4e6F9117194211C0BA1885829ccDdB06cBbaE0` |
| escalationGameFactory | Escalation Game Factory | `0x633a5B839569c4F94b1bF21B010BE24fFCafbC6b` |
| securityPoolFactory | Security Pool Factory | `0xE874d11eD2b27CBdefF9280dbc83F92f8eeFf60d` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
