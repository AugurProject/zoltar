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
| deploymentStatusOracle | Deployment Status Oracle | `0x138aa911c7E0d63DD3C81e4675EC8A08883728b3` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x47A117D404C31b5CFF82883D40c0610404D26a60` |
| scalarOutcomes | ScalarOutcomes | `0x5890b011CF7E36d4Fee28Bac8B5be6f61C392a4C` |
| securityPoolUtils | SecurityPoolUtils | `0x9E90338b17E1Fea80Cd356607EbB6eC46653fB24` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0xeadF91d12F549786891350B3D535638713651207` |
| zoltar | Zoltar | `0xd282Ae3cC11423c740afD608e715CD4e22831A29` |
| shareTokenFactory | ShareTokenFactory | `0x253d011F3A0f46096A4756a439543E9Dab36AA23` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0x38d22Ec4282621eeeBE4EBFf04E08b893dC020FF` |
| securityPoolForker | Security Pool Forker | `0x290BF23Dd1912AdEDBdfd7419b85605C66e3d24B` |
| escalationGameFactory | Escalation Game Factory | `0x94A7FB6E5a8EDC6559B748aD4FEAd0Bc68f4fCfD` |
| securityPoolFactory | Security Pool Factory | `0x0070464ef3Fb90B5D3e128e47D5ffB20e12f24E6` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
