import type { ContractReference } from './contract-reference-metadata.mts'
export const coreContractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: '580109cfcebb3ce505def01895f7b6567e75bbd8e8ccac857bdd00d54f15c37f',
		name: 'ZoltarQuestionData',
		purpose: 'Creates immutable, content-addressed scalar or categorical questions and exposes their display metadata.',
		readAbiFingerprint: '99f2b8a4050d1976f27248afe6870e944c9dc4377e193ee5e3f87a7112ffc3ac',
		readSurface:
			'Use `getQuestionId` before submission; `questionCreatedTimestamp` and `questions` for direct lookup; `getQuestionCount` and `getQuestions` for indexed or paged discovery; and `getQuestionEndDate`, `getOutcomeLabels`, `splitUint256IntoTwoWithInvalid`, `hasNonZeroScalarReservedBits`, `isMalformedAnswerOption`, and `getAnswerOptionName` when validating or displaying answers. In the `QuestionData` tuple, `startTime` and `endTime` are `uint48`, while `numTicks` is `uint120`; clients must use these exact widths because they determine the `getQuestionId` and `createQuestion` selectors. An unregistered question has no valid scalar answer: both answer getters treat everything except canonical Invalid as malformed. When a scalar range spans fewer 18-decimal units than it has ticks, a tick whose value is rounded down is named with its index, for example `0 (tick 1 of 2)`, so distinct answers never share a name.',
		readDeclarations: [
			{
				name: 'getQuestionId',
			},
			{
				name: 'getQuestionCount',
			},
			{
				name: 'getQuestions',
			},
			{
				name: 'getQuestionEndDate',
			},
			{
				name: 'getOutcomeLabels',
			},
			{
				name: 'splitUint256IntoTwoWithInvalid',
			},
			{
				name: 'hasNonZeroScalarReservedBits',
			},
			{
				name: 'isMalformedAnswerOption',
			},
			{
				name: 'getAnswerOptionName',
			},
		],
		readStorageDeclarations: [
			{
				name: 'questionCreatedTimestamp',
			},
			{
				name: 'questions',
			},
		],
		sourcePath: 'solidity/contracts/ZoltarQuestionData.sol',
		interactions: [
			{
				call: '`createQuestion(questionData, outcomeOptions)`',
				caller: 'Anyone',
				effect: 'Stores the question at its deterministic content hash, records the creation timestamp, appends it to discovery order, and stores categorical labels when supplied.',
				declarations: [
					{
						name: 'createQuestion',
					},
				],
				preconditions:
					'Question ID not already created; end time is on or after start time. Scalar questions use no labels, require display maximum greater than minimum, and positive ticks. Categorical labels use 1–64 printable ASCII characters with single interior spaces, must be unique ignoring ASCII case, and cannot use the reserved protocol names Invalid or Malformed (`Reserved protocol outcome label`). Their `keccak256(abi.encode(label))` values are strictly descending.',
				signals: '`QuestionCreated`',
			},
		],
	},
	{
		compiledAbiFingerprint: '9fce09c68c109d4ffabc5f85f0813ec2d92515318b265554fa40270759a1a006',
		name: 'Zoltar',
		purpose: 'Registers universe forks, charges the [fork haircut](./glossary.html#fork-haircut), and mints branch-specific [child REP](./glossary.html#child-rep).',
		readAbiFingerprint: 'af953dbf8c9829c81943e2873905308a3a57839625fa5f1ee8e7812f3438883d',
		readSurface:
			'Use `universes`, `forkThresholdDivisor`, `forkBurnDivisor`, `zoltarQuestionData`, `genesisReputationToken`, `childReputationTokenCount`, `getForkTime`, `getForkChoiceDeadline`, `getForkRecapitalizationDeadline`, `getEarliestForkTime`, `forkQuestionMatches`, `getRepToken`, `getForkThresholdAttoRep`, `getNonDecisionThresholdAttoRep`, `getUniverseTheoreticalSupplyAttoRep`, `getChildUniverseId`, `getDeployedChildUniverses`, `getMigrationRepBalanceAttoRep`, and `getChildMigrationRepAmountsAttoRep` to reconstruct universe and migration state. The choice and recap deadlines are the native fork time plus eight and nine weeks. A child may next fork at its parent fork time plus ten weeks; origin universes have no parent cooldown, and `getEarliestForkTime` reverts with `Unknown universe` for an ID with no REP token. Late preparation never moves these timestamps. The child migration getter accepts an array of child universe IDs and returns cumulative amounts in the same order, with zero for unused IDs. Before the first genesis fork, theoretical supply follows the external REP token minus Zoltar burns; that fork freezes the child admission caps. Later external supply changes do not enlarge them. The fork threshold is the live universe theoretical supply divided by `forkThresholdDivisor`, rounded up, so every nonzero-supply universe has a positive fork cost. `UniverseInitialized` contains the genesis supply snapshot. Read the current supply from `getUniverseTheoreticalSupplyAttoRep` and discover children through `DeployChild` and `ChildReputationTokenInitialized`. The [constructor](solidity/contracts/Zoltar.sol) enforces the genesis REP supply and divisor bounds. Genesis REP uses ordinary ERC-20 approvals because the configured mainnet genesis tokens, Augur V2’s REP Yes and REP No fork child tokens, do not implement ERC-2612 or ERC-3009. [Mainnet genesis tokens](../explanation/zoltar.html#mainnet-genesis-tokens) explains their supply growth and the low REP No fork threshold.',
		securityBoundary: 'These calls depend on [A15 intended question selection](./security-model.html#assumption-a15) and [A25 safe immutable parameters](./security-model.html#assumption-a25).',
		readDeclarations: [
			{
				name: 'getForkTime',
			},
			{
				name: 'getForkChoiceDeadline',
			},
			{
				name: 'getForkRecapitalizationDeadline',
			},
			{
				name: 'getEarliestForkTime',
			},
			{
				name: 'forkQuestionMatches',
			},
			{
				name: 'getRepToken',
			},
			{
				name: 'getForkThresholdAttoRep',
			},
			{
				name: 'getNonDecisionThresholdAttoRep',
			},
			{
				name: 'getUniverseTheoreticalSupplyAttoRep',
			},
			{
				name: 'getChildUniverseId',
			},
			{
				name: 'getDeployedChildUniverses',
			},
			{
				name: 'getMigrationRepBalanceAttoRep',
			},
			{
				name: 'getChildMigrationRepAmountsAttoRep',
			},
		],
		readStorageDeclarations: [
			{
				name: 'universes',
			},
			{
				name: 'forkThresholdDivisor',
			},
			{
				name: 'forkBurnDivisor',
			},
			{
				name: 'zoltarQuestionData',
			},
			{
				name: 'genesisReputationToken',
			},
			{
				name: 'childReputationTokenCount',
			},
		],
		sourcePath: 'solidity/contracts/Zoltar.sol',
		interactions: [
			{
				call: '`forkUniverse(universeId, questionId)`',
				caller: 'Any address able to fund the current fork threshold',
				effect: 'Records the fork, removes threshold REP from the parent universe, and credits the caller with the threshold minus the uncredited fork haircut.',
				declarations: [
					{
						name: 'forkUniverse',
					},
				],
				preconditions: 'Initialized and unforked universe; existing ended question; sufficient caller REP; a child must have reached its parent fork timestamp plus ten weeks. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: 'The REP burn events (genesis REP `Transfer` to the burn address, or child REP `Transfer` and `Burn`), then `UniverseForked`',
			},
			{
				call: '`burnRep(universeId, amountAttoRep)`',
				caller: 'Any REP holder; the caller can burn only its own balance',
				effect: 'Permanently removes REP without creating migration credit; escalation settlement uses this to burn the [escalation haircut](./glossary.html#escalation-haircut) when its own fork has not already paid it.',
				declarations: [
					{
						name: 'burnRep',
					},
				],
				preconditions: 'Initialized universe; positive amount; sufficient caller REP and theoretical supply. Genesis REP requires allowance.',
				signals: 'The REP burn events (genesis REP `Transfer` to the burn address, or child REP `Transfer` and `Burn`), then `RepBurned`',
			},
			{
				call: '`deployChild(universeId, outcomeIndex)`',
				caller: 'Anyone',
				effect: 'Deploys the deterministic child REP token and initializes the child universe.',
				declarations: [
					{
						name: 'deployChild',
					},
				],
				preconditions: 'Parent forked; outcome is well formed; child is not already deployed.',
				signals: '`TheoreticalSupplySet`, `ReputationTokenInitialized`, `DeployChild`, and `ChildReputationTokenInitialized`',
			},
			{
				call: '`addRepToMigrationBalance(universeId, amountAttoRep)`',
				caller: 'Parent REP holder',
				effect: "Burns or sinks additional parent REP and increases the caller's reusable migration balance.",
				declarations: [
					{
						name: 'addRepToMigrationBalance',
					},
				],
				preconditions: 'Universe forked; sufficient caller REP. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: 'The REP burn events (genesis REP `Transfer` to the burn address, or child REP `Transfer` and `Burn`), then `MigrationRepAdded`',
			},
			{
				call: '`prepareAndSplitMigrationRep(universeId, amountAttoRep, outcomeIndexes, preparationAttoRep)`',
				caller: 'Parent REP holder',
				effect:
					'Adds the supplied preparation amount to migration credit, then splits the requested REP into the supplied outcomes using the existing migration checks. Both steps revert together on failure. Callers compute any preparation shortfall from cumulative child migration amounts, rather than current child token holdings.',
				declarations: [
					{
						name: 'prepareAndSplitMigrationRep',
					},
				],
				preconditions: 'Forked universe; positive split amount; nonempty valid outcomes; sufficient parent REP for the exact `preparationAttoRep` supplied and sufficient migration credit for every split. Outcome order is unrestricted. Genesis REP requires allowance for preparation; child REP needs no allowance.',
				signals: 'The `addRepToMigrationBalance` signals when `preparationAttoRep` is positive; `TheoreticalSupplySet`, `ReputationTokenInitialized`, `DeployChild`, and `ChildReputationTokenInitialized` when children are deployed; child REP `Transfer`, `Mint`, and `MigrationRepSplit` for each destination',
			},
			{
				call: '`splitMigrationRep(universeId, amountAttoRep, outcomeIndexes)`',
				caller: 'Migration-balance holder',
				effect: 'Mints `amountAttoRep` of child REP into every selected branch, deploying missing children lazily.',
				declarations: [
					{
						name: 'splitMigrationRep',
					},
				],
				preconditions: "Universe forked; positive split amount; nonempty list of well-formed outcomes; the cumulative amount per child must not exceed the caller's migration balance.",
				signals: '`TheoreticalSupplySet`, `ReputationTokenInitialized`, `DeployChild`, and `ChildReputationTokenInitialized` when children are deployed; child REP `Transfer` and `Mint`, then `MigrationRepSplit`, per selected branch',
			},
		],
	},
	{
		compiledAbiFingerprint: 'c870ce39465c90820caef827233163f7898f339aba3563d29b7014e60da28687',
		name: 'ReputationToken',
		purpose: 'Implements universe-specific ERC-20 REP, ERC-2612 permits, and ERC-3009 transfers while enforcing the supply ceiling maintained by Zoltar.',
		readAbiFingerprint: '1cedbd5efbd60e56cb8f88586096eba913a58cbf7fc5d9908649ea4cc8a0658b',
		readSurface:
			'Use `getTotalTheoreticalSupply`, `zoltar`, `universeId`, and `repNumber` to identify the token and its supply ceiling; the standard ERC-20 reads `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, and `allowance` for balances; and `nonces`, `DOMAIN_SEPARATOR`, and `authorizationState` to build and check ERC-2612 and ERC-3009 signatures.',
		readDeclarations: [
			{
				name: 'getTotalTheoreticalSupply',
			},
			{
				name: 'name',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'symbol',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'decimals',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'totalSupply',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'balanceOf',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'allowance',
				sourcePath: 'solidity/contracts/ERC20.sol',
			},
			{
				name: 'nonces',
				sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
			},
			{
				name: 'DOMAIN_SEPARATOR',
				sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
			},
			{
				name: 'authorizationState',
				sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
			},
		],
		readStorageDeclarations: [
			{
				name: 'zoltar',
			},
			{
				name: 'universeId',
			},
			{
				name: 'repNumber',
			},
		],
		sourcePath: 'solidity/contracts/ReputationToken.sol',
		interactions: [
			{
				call: '`initialize(universeId, totalTheoreticalSupplyAttoRep, repNumber)`',
				caller: '`Zoltar` only',
				effect: 'Atomically assigns the child universe, global display sequence, name, symbol, and theoretical-supply ceiling used to bound migration mints.',
				declarations: [
					{
						name: 'initialize',
					},
				],
				preconditions: 'Called once by Zoltar as part of child-universe creation; universe, REP number, and theoretical supply are nonzero; supply does not exceed 11 million REP.',
				signals: '`TheoreticalSupplySet` and `ReputationTokenInitialized`',
			},
			{
				call: '`mint(account, valueAttoRep)`',
				caller: '`Zoltar` only',
				effect: 'Mints branch REP to an account.',
				declarations: [
					{
						name: 'mint',
					},
				],
				preconditions: '`account` is nonzero; resulting ERC-20 supply does not exceed theoretical supply.',
				signals: '`Mint` and ERC-20 `Transfer`',
			},
			{
				call: '`burn(account, valueAttoRep)`',
				caller: '`Zoltar` only',
				effect: 'Burns account REP and reduces both actual and theoretical supply by the same amount.',
				declarations: [
					{
						name: 'burn',
					},
				],
				preconditions: '`account` is nonzero and has sufficient REP; theoretical supply covers the burn.',
				signals: '`Burn` and ERC-20 `Transfer`',
			},
			{
				call: '`transfer(to, value)`',
				caller: 'REP holder',
				effect: 'Moves REP from the caller without changing actual or theoretical supply.',
				declarations: [
					{
						name: 'transfer',
						sourcePath: 'solidity/contracts/ERC20.sol',
					},
				],
				preconditions: 'Destination is nonzero; caller has sufficient balance.',
				signals: '`Transfer`',
			},
			{
				call: '`approve(spender, value)`',
				caller: 'Any REP account setting its own allowance',
				effect: 'Replaces the named spender allowance without moving REP.',
				declarations: [
					{
						name: 'approve',
						sourcePath: 'solidity/contracts/ERC20.sol',
					},
				],
				preconditions: 'Spender is nonzero.',
				signals: '`Approval`',
			},
			{
				call: '`transferFrom(from, to, value)`',
				caller: 'A spender with sufficient allowance from `from`',
				effect: 'Moves REP from `from`; a finite allowance decreases by `value`, while an infinite allowance remains unchanged. Neither allowance path emits `Approval`.',
				declarations: [
					{
						name: 'transferFrom',
						sourcePath: 'solidity/contracts/ERC20.sol',
					},
				],
				preconditions: 'Source and destination are nonzero; source has sufficient balance; caller has sufficient allowance, including when caller equals source.',
				signals: '`Transfer` only',
			},
			{
				call: '`permit(owner, spender, value, deadline, v, r, s)`',
				caller: "Anyone presenting the owner's valid ERC-2612 signature",
				effect: "Sets the signed allowance and advances the owner's permit nonce.",
				declarations: [
					{
						name: 'permit',
						sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
					},
				],
				preconditions: 'Deadline has not passed; signature matches the current chain, token domain, owner, spender, value, and nonce.',
				signals: '`Approval`',
			},
			{
				call: '`transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`',
				caller: "Anyone presenting the source's valid ERC-3009 signature",
				effect: 'Consumes the authorization nonce and transfers the exact signed amount to the signed recipient.',
				declarations: [
					{
						name: 'transferWithAuthorization',
						sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
					},
				],
				preconditions: 'The strict validity window is open; the nonce is unused; signature fields and source balance are valid.',
				signals: '`AuthorizationUsed` and `Transfer`',
			},
			{
				call: '`receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`',
				caller: "The signed recipient presenting the source's valid ERC-3009 signature",
				effect: 'Consumes the authorization nonce and transfers the exact signed amount to the caller-bound recipient.',
				declarations: [
					{
						name: 'receiveWithAuthorization',
						sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
					},
				],
				preconditions: 'Caller equals the signed recipient; the strict validity window is open; the nonce is unused; signature fields and source balance are valid.',
				signals: '`AuthorizationUsed` and `Transfer`',
			},
			{
				call: '`cancelAuthorization(authorizer, nonce, v, r, s)`',
				caller: "Anyone presenting the authorizer's valid ERC-3009 cancellation signature",
				effect: 'Marks the authorization nonce as consumed without transferring tokens.',
				declarations: [
					{
						name: 'cancelAuthorization',
						sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
					},
				],
				preconditions: 'The nonce is unused and the cancellation signature matches the authorizer.',
				signals: '`AuthorizationCanceled`',
			},
		],
	},
	{
		compiledAbiFingerprint: '820a41f499c7c3888980fc0d633b9afb13136f3f2a71a9d959d79f68a790bc3e',
		name: 'SecurityPoolFactory',
		purpose: 'Deploys every security pool from pinned creation code and module deployers, and deploys and registers their question ledgers and shared price feeds. No standalone deployment entry point exists.',
		readAbiFingerprint: 'c5bae8b03b730f22009ece36ed0b8cedb22792b6f4ac7f0b4647659cd881021b',
		readSurface:
			'Each question derives its start bond as max(1 REP, universe theoretical REP supply / 10,000,000). `questionLedgerDeploymentCount` and strict `questionLedgerDeploymentsRange` enumerate canonical question ledgers. `isSecurityPool` is true only for a security pool this factory deployed, and `securityPoolCreationCodeHash` is the hash of the only creation code it deploys. `securityPoolCount` and strict `securityPoolsRange` enumerate, in registration order, the factory-deployed security pools that have configured their namespace; a deployed security pool is listed when its final setup step calls `initializeSecurityPoolPriceFeed`. `getQuestionLedgerId`, `getQuestionLedger`, `getQuestionLedgerOriginId` and `getQuestionLedgerHasInheritedForkOutcome` identify their lineage. `getQuestionOriginId` includes the caller security pool namespace. `securityPoolOf` returns the factory-deployed security pool a ledger belongs to; `sharedPriceFeeds` is indexed by security pool and universe. `getChildQuestionLedgerCoordinator` returns the prepared child coordinator, or zero before preparation. `maximumReportPriorityFeeAttoEthPerGas` exposes the configured coordinator-factory ceiling used to reject over-cap security pool creation before setup. `zoltar` identifies the protocol root.',
		readDeclarations: [
			{ name: 'maximumReportPriorityFeeAttoEthPerGas' },
			{
				name: 'questionLedgerDeploymentCount',
			},
			{
				name: 'questionLedgerDeploymentsRange',
			},
			{
				name: 'securityPoolCount',
			},
			{
				name: 'securityPoolsRange',
			},
			{
				name: 'getQuestionLedgerId',
			},
			{
				name: 'getQuestionLedger',
			},
			{
				name: 'getQuestionLedgerOriginId',
			},
			{
				name: 'getQuestionLedgerHasInheritedForkOutcome',
			},
			{
				name: 'getQuestionOriginId',
			},
			{
				name: 'securityPoolOf',
			},
			{
				name: 'getChildQuestionLedgerCoordinator',
			},
		],
		readStorageDeclarations: [
			{
				name: 'isSecurityPool',
			},
			{
				name: 'securityPoolCreationCodeHash',
			},
			{
				name: 'sharedPriceFeeds',
			},
			{
				name: 'zoltar',
			},
		],
		sourcePath: 'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol',
		interactions: [
			{
				call: '`deploySecurityPool(creationCode, configuration)`',
				caller: 'Anyone',
				effect:
					'Deploys a `SecurityPool` whose leading constructor arguments are this factory and its nine pinned module deployers, records it in `isSecurityPool`, and returns its address. The deployment uses CREATE2 with a salt derived from the caller and the number of security pools that caller has deployed, so the address depends on its creator and no other deployment can occupy it. `configuration` is the ABI encoding of the origin configuration, question horizon, admission policy and economics, in that order: the only values the creator chooses.',
				declarations: [
					{
						name: 'deploySecurityPool',
					},
				],
				preconditions:
					'`keccak256(creationCode)` equals `securityPoolCreationCodeHash` (`Security pool creation code is not canonical`); `configuration` is exactly 13 words (`Security pool configuration length invalid`). The security pool constructor\u2019s own checks apply and revert the deployment, including that every pinned module deployer holds code.',
				signals: '`SecurityPoolDeployed` with the security pool and the caller. Setup continues through the security pool\u2019s `prepareNext`.',
			},
			{
				call: '`initializeSecurityPoolPriceFeed(universeId, priorityFee)`',
				caller: 'A security pool this factory deployed, within its own caller-address namespace',
				effect:
					'The first call creates the caller namespace\u2019s oracle configuration from the universe\u2019s REP token and the priority fee, and appends the caller to the security pool registry. Each call creates the namespace\u2019s feed for that universe or returns the existing one. Security pool setup calls this in its last stage, before any question is admitted.',
				declarations: [
					{
						name: 'initializeSecurityPoolPriceFeed',
					},
				],
				preconditions:
					'The universe has a REP token and has not forked. A repeated call must match the first call\u2019s REP token and priority fee. The feed starts without an accepted price. The caller satisfies `isSecurityPool` (`Security pool is not canonical`), so no other contract can open a namespace. This call neither registers a question nor allocates REP.',
				signals: 'Returns the canonical feed address. The first setup emits `SecurityPoolRegistered`. Each new feed emits `SharedPriceFeedRegistered` with the security pool, universe and feed address.',
			},
			{
				call: '`initializeSecurityPoolPriceFeedForUniverse(universeId)`',
				caller: 'A security pool, within its own caller-address namespace',
				effect: 'Creates or retrieves the caller namespace\u2019s feed for an already registered child universe, using the oracle configuration from the namespace\u2019s first `initializeSecurityPoolPriceFeed` call. No question needs to be deployed first.',
				declarations: [
					{
						name: 'initializeSecurityPoolPriceFeedForUniverse',
					},
				],
				preconditions: 'The caller has configured its namespace; the caller\u2019s security pool clock recognizes the target universe; the target REP token exists.',
				signals: 'Returns the canonical feed address. A newly deployed feed emits `SharedPriceFeedRegistered`.',
			},
			{
				call: '`prepareSecurityPoolPriceFeed(source, universeId)`',
				caller: 'Anyone',
				effect: 'Creates or retrieves a target universe feed in the canonical source question ledger\u2019s security pool namespace without moving provider capital.',
				declarations: [
					{
						name: 'prepareSecurityPoolPriceFeed',
					},
				],
				preconditions: 'Canonical source question ledger registered to a security pool; the security pool clock recognizes the target; the target REP token exists.',
				signals: 'Returns the canonical feed address. A newly deployed feed emits `SharedPriceFeedRegistered`.',
			},
			{
				call: '`deploySecurityPoolQuestionLedger(universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)`',
				caller: 'A security pool with a configured namespace, within its own caller-address namespace',
				effect:
					'Creates a separate origin ledger and share token in the caller namespace, attaching its coordinator to the namespace/universe shared REP/ETH feed. Security pool admission calls this from the security pool contract, after its immutable admission policy allows the question; it then enforces the question horizon, with failure reverting deployment.',
				declarations: [
					{
						name: 'deploySecurityPoolQuestionLedger',
					},
				],
				preconditions:
					'The caller has configured its namespace (`Security pool configuration missing`), which only a factory-deployed security pool can do. The ordinary origin deployment checks apply; no lineage for this question/configuration has been claimed in the caller namespace. The namespace is derived from msg.sender and cannot be supplied on behalf of another security pool.',
				signals: '`SharedPriceFeedSet`, feed `CoordinatorRegistered`, `QuestionLedgerRegistered`, and `DeployQuestionLedger`',
			},
			{
				call: '`prepareSecurityPoolChildPriceFeed(parent, outcomeIndex)`',
				caller: 'Anyone',
				effect: 'Prepares the child universe\u2019s REP token and shared feed in a separate transaction before creating a child question ledger. Repeated preparation returns the same feed without moving capital or selecting any owner\u2019s migration.',
				declarations: [
					{
						name: 'prepareSecurityPoolChildPriceFeed',
					},
				],
				preconditions: 'The parent is a canonical question ledger in PoolForked state. Its namespace and oracle configuration determine the feed; Zoltar determines the selected child universe and its REP token.',
				signals: 'Returns the canonical child feed address. A newly deployed feed emits `SharedPriceFeedRegistered`. Child REP deployment may emit Zoltar events.',
			},
			{
				call: '`prepareChildQuestionLedgerCoordinator(parent, outcomeIndex)`',
				caller: 'Anyone',
				effect: 'Predeploys the canonical child coordinator separately from the question ledger. Repeated calls return the same coordinator.',
				declarations: [
					{
						name: 'prepareChildQuestionLedgerCoordinator',
					},
				],
				preconditions: 'The parent is a canonical ledger in PoolForked state. A security pool must first prepare its child feed. Missing child REP is deployed through Zoltar. The authenticated factory chain exclusively controls subsequent coordinator binding.',
				signals: 'Returns the coordinator address; no `DeployQuestionLedger` until the child ledger is deployed.',
			},
			{
				call: '`deployChildQuestionLedger(parent, shareToken, universeId, questionId, statoblastSecurityMultiplierBps)`',
				caller: '`QuestionForker` only (`Only question forker`)',
				effect: 'Creates and registers a canonical child question ledger with the parent share token and a coordinator attached to its security pool branch feed.',
				declarations: [
					{
						name: 'deployChildQuestionLedger',
					},
				],
				preconditions:
					'Parent is the canonical question ledger for its lineage; supplied share token equals the parent share token; no question ledger has already been claimed for the parent origin in the target universe; a security pool child feed has already been prepared; deployment arguments satisfy downstream constructors and wiring.',
				signals: '`QuestionLedgerRegistered`, then `DeployQuestionLedger`',
			},
		],
	},
]
