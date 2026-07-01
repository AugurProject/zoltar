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
| deploymentStatusOracle | Deployment Status Oracle | `0x5c8594ce4d9A3307e6E6e5E16C1473Dd424fDdbf` |
| multicall3 | Multicall3 | `0x77609e84c39893D5fB99049FE0F461aEB4F4Ec79` |
| uniformPriceDualCapBatchAuctionFactory | UniformPriceDualCapBatchAuctionFactory | `0x71761Fa073a1b5FA49154637Cf61b85172E8cA15` |
| scalarOutcomes | ScalarOutcomes | `0x375993210Bd295D329CaB7EeD4CEE17C73493af5` |
| securityPoolUtils | SecurityPoolUtils | `0x04349f6A0302F32f8c87bb8555648AD77634343C` |
| openOracle | OpenOracle | `0x51DED022c087758c187ce636aa5f6adE6B919abB` |
| zoltarQuestionData | ZoltarQuestionData | `0x3fDE26F6C206DDc4991087FCeB5f13EC9f6F3E94` |
| zoltar | Zoltar | `0x5FaE7E52e81250Fad0fCF05db42eCCCB3B0Bed95` |
| shareTokenFactory | ShareTokenFactory | `0x967099046B795125Ab89BCA24da1A1876EFc69BD` |
| priceOracleManagerAndOperatorQueuerFactory | Price Oracle Manager Factory | `0xBAF4AC7FE959090ab32308e3E9ccD7628645F31c` |
| securityPoolForker | Security Pool Forker | `0x51fE6A3e8aCcC8d1A3Ed4339496735d763337DEa` |
| escalationGameFactory | Escalation Game Factory | `0x4e5119B43741efF8d58824e621B934e4F70DfBC7` |
| securityPoolFactory | Security Pool Factory | `0xE61feebDAe6DB6E42d517F4ce7364F56799C4670` |

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
| escalationGameProofVerifier | Escalation Game Proof Verifier | `0x6a8Dcb0c794ad8fEAFc94D7c4b8c026DcE108f5f` |

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
