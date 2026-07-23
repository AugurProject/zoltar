// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniformPriceDualCapBatchAuction } from '../../peripherals/UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from '../../peripherals/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../peripherals/interfaces/IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { SecurityPoolForkerBase } from '../../peripherals/SecurityPoolForkerBase.sol';
import { Zoltar } from '../../Zoltar.sol';

contract SecurityPoolForkerChildGameValidationHarness is SecurityPoolForkerBase {
	constructor(Zoltar zoltar) SecurityPoolForkerBase(zoltar) {}

	function finalizeEscalationStateAfterAuction(ISecurityPool child) external {
		_finalizeEscalationStateAfterAuction(child, true);
	}
}

contract SecurityPoolForkerMaliciousEventEmitter {
	ISecurityPool private immutable targetPool;
	address payable private immutable receiver;

	constructor(ISecurityPool configuredTargetPool, address payable configuredReceiver) {
		targetPool = configuredTargetPool;
		receiver = configuredReceiver;
	}

	function emitForkSnapshotEvents(ISecurityPool, address, address, uint256, uint256, uint256) external {
		targetPool.transferEth(receiver, targetPool.completeSetCollateralAmount());
	}
}

contract SecurityPoolForkerFakePoolMock {
	uint248 private immutable configuredUniverseId;
	ReputationToken private immutable configuredRepToken;
	uint256 private immutable configuredQuestionId;
	address private immutable configuredEventEmitter;
	address private immutable configuredEscalationGame;

	constructor(
		uint248 configuredUniverse,
		ReputationToken configuredRep,
		uint256 configuredQuestion,
		address configuredEmitter,
		address configuredGame
	) {
		configuredUniverseId = configuredUniverse;
		configuredRepToken = configuredRep;
		configuredQuestionId = configuredQuestion;
		configuredEventEmitter = configuredEmitter;
		configuredEscalationGame = configuredGame;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverseId;
	}

	function systemState() external pure returns (SystemState) {
		return SystemState.Operational;
	}

	function escalationGame() external view returns (address) {
		return configuredEscalationGame;
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestionId;
	}

	function activateForkMode(bool) external pure {}

	function completeSetCollateralAmount() external pure returns (uint256) {
		return 0;
	}

	function securityPoolEventEmitter() external view returns (address) {
		return configuredEventEmitter;
	}
}

contract SecurityPoolForkerAttackFactoryMock {
	ISecurityPool private immutable childPool;
	UniformPriceDualCapBatchAuction private immutable childTruthAuction;

	constructor(ISecurityPool configuredChildPool, UniformPriceDualCapBatchAuction configuredChildTruthAuction) {
		childPool = configuredChildPool;
		childTruthAuction = configuredChildTruthAuction;
	}

	function deployChildSecurityPool(
		ISecurityPool,
		IShareToken,
		uint248,
		uint256,
		uint256,
		uint256,
		uint256
	) external view returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		return (childPool, childTruthAuction);
	}
}

contract SecurityPoolForkerAttackParentMock {
	SystemState private immutable configuredSystemState;
	uint248 private immutable configuredUniverseId;
	ISecurityPoolFactory private immutable configuredSecurityPoolFactory;
	IShareToken private immutable configuredShareToken;
	uint256 private immutable configuredQuestionId;
	uint256 private immutable configuredSecurityMultiplier;
	uint256 private immutable configuredCompleteSetCollateralAmount;
	uint256 private immutable configuredTotalSecurityBondAllowance;
	uint256 private immutable configuredPoolOwnershipDenominator;

	constructor(
		uint248 configuredUniverse,
		ISecurityPoolFactory configuredFactory,
		IShareToken configuredShareTokenAddress,
		uint256 configuredQuestion,
		uint256 configuredMultiplier,
		uint256 configuredCollateralAmount,
		uint256 configuredBondAllowance,
		uint256 configuredDenominator
	) {
		configuredSystemState = SystemState.PoolForked;
		configuredUniverseId = configuredUniverse;
		configuredSecurityPoolFactory = configuredFactory;
		configuredShareToken = configuredShareTokenAddress;
		configuredQuestionId = configuredQuestion;
		configuredSecurityMultiplier = configuredMultiplier;
		configuredCompleteSetCollateralAmount = configuredCollateralAmount;
		configuredTotalSecurityBondAllowance = configuredBondAllowance;
		configuredPoolOwnershipDenominator = configuredDenominator;
	}

	function systemState() external view returns (SystemState) {
		return configuredSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverseId;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredSecurityPoolFactory;
	}

	function shareToken() external view returns (IShareToken) {
		return configuredShareToken;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestionId;
	}

	function securityMultiplier() external view returns (uint256) {
		return configuredSecurityMultiplier;
	}

	function completeSetCollateralAmount() external view returns (uint256) {
		return configuredCompleteSetCollateralAmount;
	}

	function totalSecurityBondAllowance() external view returns (uint256) {
		return configuredTotalSecurityBondAllowance;
	}

	function poolOwnershipDenominator() external view returns (uint256) {
		return configuredPoolOwnershipDenominator;
	}

	function authorizeChildPool(ISecurityPool) external pure {}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}
}

contract SecurityPoolForkerEscrowAttackFactoryMock {
	ISecurityPool private childPool;
	UniformPriceDualCapBatchAuction private childTruthAuction;
	bytes32 private configuredOriginId = keccak256('fake escalation lineage');

	function configureChild(
		ISecurityPool configuredChildPool,
		UniformPriceDualCapBatchAuction configuredChildTruthAuction
	) external {
		childPool = configuredChildPool;
		childTruthAuction = configuredChildTruthAuction;
	}

	function configureOriginId(bytes32 originId) external {
		configuredOriginId = originId;
	}

	function getSecurityPoolOriginId(ISecurityPool) external view returns (bytes32) {
		return configuredOriginId;
	}

	function deployChildSecurityPool(
		ISecurityPool,
		IShareToken,
		uint248,
		uint256,
		uint256,
		uint256,
		uint256
	) external view returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		return (childPool, childTruthAuction);
	}
}

contract SecurityPoolForkerEscrowAttackGameMock {
	ISecurityPool private immutable configuredSecurityPool;
	ReputationToken private immutable configuredRepToken;
	address private immutable configuredDepositor;
	uint256 private immutable configuredClaimAmount;

	constructor(
		ISecurityPool securityPoolAddress,
		ReputationToken repTokenAddress,
		address depositor,
		uint256 claimAmount
	) {
		configuredSecurityPool = securityPoolAddress;
		configuredRepToken = repTokenAddress;
		configuredDepositor = depositor;
		configuredClaimAmount = claimAmount;
	}

	function securityPool() external view returns (ISecurityPool) {
		return configuredSecurityPool;
	}

	function nonDecisionTimestamp() external pure returns (uint256) {
		return 1;
	}

	function canTriggerOwnFork() external pure returns (bool) {
		return true;
	}

	function getQuestionResolution() external pure returns (BinaryOutcomes.BinaryOutcome) {
		return BinaryOutcomes.BinaryOutcome.None;
	}

	function getEscalationGameEndDate() external pure returns (uint256) {
		return type(uint256).max;
	}

	function getForkCarrySnapshot()
		external
		pure
		returns (
			bytes32[64][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotals,
			bytes32[3] memory nullifierRoots
		)
	{}

	function getOutcomeBalances() external pure returns (uint256[3] memory outcomeBalances) {}

	function getForkCarryRoots() external pure returns (bytes32[3] memory carryRoots) {}

	function startBond() external pure returns (uint256) {
		return 1;
	}

	function nonDecisionThreshold() external pure returns (uint256) {
		return 1;
	}

	function forkContinuation() external pure returns (bool) {
		return false;
	}

	function exportVaultUnresolvedTotalsWithoutTransfer(address) external pure returns (uint256[3] memory) {}

	function activationTime() external pure returns (uint256) {
		return 1;
	}

	function claimDepositForWinningWithoutTransfer(
		uint256,
		BinaryOutcomes.BinaryOutcome
	) external view returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		return (configuredDepositor, configuredClaimAmount, configuredClaimAmount);
	}

	function drainToForker(address receiver) external {
		require(msg.sender == address(configuredSecurityPool), 'Only configured pool');
		uint256 balance = configuredRepToken.balanceOf(address(this));
		if (balance > 0) require(configuredRepToken.transfer(receiver, balance), 'REP transfer');
	}
}

contract SecurityPoolForkerEscrowAttackParentMock {
	SystemState private configuredSystemState = SystemState.Operational;
	ReputationToken private immutable configuredRepToken;
	ISecurityPoolFactory private immutable configuredFactory;
	IShareToken private immutable configuredShareToken;
	address private immutable configuredForker;
	uint248 private immutable configuredUniverse;
	uint256 private immutable configuredQuestion;
	uint256 private immutable configuredMultiplier;
	SecurityPoolForkerEscrowAttackGameMock private configuredEscalationGame;

	constructor(
		ReputationToken repTokenAddress,
		ISecurityPoolFactory factory,
		IShareToken shareTokenAddress,
		address forker,
		uint248 universe,
		uint256 question,
		uint256 multiplier
	) {
		configuredRepToken = repTokenAddress;
		configuredFactory = factory;
		configuredShareToken = shareTokenAddress;
		configuredForker = forker;
		configuredUniverse = universe;
		configuredQuestion = question;
		configuredMultiplier = multiplier;
	}

	function configureEscalationGame(SecurityPoolForkerEscrowAttackGameMock escalationGameAddress) external {
		configuredEscalationGame = escalationGameAddress;
	}

	function systemState() external view returns (SystemState) {
		return configuredSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestion;
	}

	function securityMultiplier() external view returns (uint256) {
		return configuredMultiplier;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function shareToken() external view returns (IShareToken) {
		return configuredShareToken;
	}

	function securityPoolForker() external view returns (address) {
		return configuredForker;
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function escalationGame() external view returns (SecurityPoolForkerEscrowAttackGameMock) {
		return configuredEscalationGame;
	}

	function activateForkMode(bool) external {
		configuredSystemState = SystemState.PoolForked;
		uint256 balance = configuredRepToken.balanceOf(address(this));
		if (balance > 0) require(configuredRepToken.transfer(msg.sender, balance), 'REP transfer');
		configuredEscalationGame.drainToForker(msg.sender);
	}

	function updateCollateralAmount() external pure {}

	function completeSetCollateralAmount() external pure returns (uint256) {
		return 0;
	}

	function totalSecurityBondAllowance() external pure returns (uint256) {
		return 0;
	}

	function poolOwnershipDenominator() external pure returns (uint256) {
		return 0;
	}

	function authorizeChildPool(ISecurityPool) external pure {}

	function updateVaultFees(address) external pure {}

	function securityVaults(
		address
	)
		external
		pure
		returns (
			uint256 poolOwnership,
			uint256 securityBondAllowance,
			uint256 repInEscalationGame,
			uint256 lastUpdatedFeeAccumulator
		)
	{}

	function configureVault(address, uint256, uint256, uint256) external pure {}
}

contract SecurityPoolForkerAlternatingChildGameMock {
	ISecurityPool private immutable configuredSecurityPool;
	uint256 private immutable configuredForkResumedAt;

	constructor(ISecurityPool securityPoolAddress, uint256 forkResumedAtValue) {
		configuredSecurityPool = securityPoolAddress;
		configuredForkResumedAt = forkResumedAtValue;
	}

	function securityPool() external view returns (ISecurityPool) {
		return configuredSecurityPool;
	}

	function forkCarrySnapshotInitialized() external pure returns (bool) {
		return true;
	}

	function forkResumedAt() external view returns (uint256) {
		return configuredForkResumedAt;
	}
}

contract SecurityPoolForkerEscrowAttackChildMock {
	ISecurityPool private immutable configuredParent;
	ISecurityPoolFactory private immutable configuredFactory;
	ReputationToken private immutable configuredRepToken;
	address private immutable configuredForker;
	address private immutable configuredTruthAuction;
	address private immutable configuredEscalationGame;
	uint248 private immutable configuredUniverse;
	address private firstOperationalEscalationGame;
	address private secondOperationalEscalationGame;
	bool private operationalMode;
	bool private useSecondOperationalEscalationGame;
	bool private awaitingContinuation;
	uint256 public forkResumeCount;

	constructor(
		ISecurityPool parentPool,
		ISecurityPoolFactory factory,
		ReputationToken repTokenAddress,
		address forker,
		address truthAuctionAddress,
		address escalationGameAddress,
		uint248 universe
	) {
		configuredParent = parentPool;
		configuredFactory = factory;
		configuredRepToken = repTokenAddress;
		configuredForker = forker;
		configuredTruthAuction = truthAuctionAddress;
		configuredEscalationGame = escalationGameAddress;
		configuredUniverse = universe;
	}

	function parent() external view returns (ISecurityPool) {
		return configuredParent;
	}

	function systemState() external view returns (SystemState) {
		return operationalMode ? SystemState.Operational : SystemState.ForkMigration;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function securityPoolForker() external view returns (address) {
		return configuredForker;
	}

	function truthAuction() external view returns (address) {
		return configuredTruthAuction;
	}

	function escalationGame() external view returns (address) {
		if (operationalMode) {
			return
				useSecondOperationalEscalationGame ? secondOperationalEscalationGame : firstOperationalEscalationGame;
		}
		return configuredEscalationGame;
	}

	function configureOperationalEscalationGames(address firstGame, address secondGame) external {
		firstOperationalEscalationGame = firstGame;
		secondOperationalEscalationGame = secondGame;
		operationalMode = true;
		awaitingContinuation = true;
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function setOwnershipDenominator(uint256) external pure {}

	function awaitingForkContinuation() external view returns (bool) {
		return awaitingContinuation;
	}

	function setAwaitingForkContinuation(bool shouldAwait) external {
		awaitingContinuation = shouldAwait;
	}

	function resumeForkedEscalationGame() external {
		forkResumeCount++;
	}

	function initializeForkCarrySnapshotWithResolutionBalances(
		address,
		bytes32,
		bytes32[64][3] memory,
		uint256[3] memory,
		uint256[3] memory,
		uint256[3] memory,
		bytes32[3] memory
	) external pure {}

	function updateVaultFees(address) external pure {}

	function securityVaults(
		address
	)
		external
		pure
		returns (
			uint256 poolOwnership,
			uint256 securityBondAllowance,
			uint256 repInEscalationGame,
			uint256 lastUpdatedFeeAccumulator
		)
	{}

	function feeIndex() external pure returns (uint256) {
		return 0;
	}

	function configureVault(address, uint256, uint256, uint256) external {
		if (operationalMode) useSecondOperationalEscalationGame = true;
	}

	function poolOwnershipDenominator() external pure returns (uint256) {
		return 0;
	}

	function totalSecurityBondAllowance() external pure returns (uint256) {
		return 0;
	}
}
