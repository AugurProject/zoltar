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
| deploymentStatusOracle | Deployment Status Oracle | `0x725502CbB4877619dC825e7CB4a83FCa1bB809bE` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0xbA605970da511b08539bcC4F77B54CF1Cd72783c` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0x6b5003e3715D5Bc8C753ca9822A0c550801B1fca` |
| shareTokenFactory | ShareTokenFactory | `0x6a360dD5d6b958ED1690296D0B3D003E290B4e0e` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xb1779119842a8692cf0a47Fc743A90744f910092` |
| securityPoolForker | Security Pool Forker | `0x19a2ba34c49Cb9aB9289F35fe36b4C28F6e0B582` |
| escalationGameFactory | Escalation Game Factory | `0xDF85248e59F374DC46B32d83368f0c7DE9878Ae5` |
| securityPoolFactory | Security Pool Factory | `0x78FE3889B0329d36EBC52216EAD96F2048efC9AE` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
