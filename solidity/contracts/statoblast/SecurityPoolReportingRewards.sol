// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IPortfolioServiceRoot } from './interfaces/IPortfolioServiceRoot.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';

/// @notice Reporter attribution and conservative funded bounty limits.
/// @dev No asset custody: the services contract retains all reward cash and REP.
contract SecurityPoolReportingRewards {
	address public immutable portfolio;
	address public immutable services;
	struct Reporter {
		address beneficiary;
		BinaryOutcomes.BinaryOutcome leader;
		bool registered;
		uint256 rewardCapAttoEth;
	}
	mapping(address => Reporter) public reportingBeneficiaries;
	constructor(address authority, address serviceAuthority) {
		portfolio = authority;
		services = serviceAuthority;
	}
	modifier onlyServices() {
		require(msg.sender == services, 'Only reporting services');
		_;
	}
	function quoteReportingReward(address poolAddress) public view returns (address recipient, uint256 cashAttoEth) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		require(root.registeredPools(poolAddress), 'Unknown reward question');
		ISecurityPool pool = ISecurityPool(payable(poolAddress));
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(pool.securityPoolForker()).getQuestionOutcome(pool);
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (address(0), 0);
		(bool fixedOutcome, ) = root.inheritedFixedOutcome(pool.universeId(), pool.questionId());
		Reporter storage reporter = reportingBeneficiaries[address(pool.escalationGame())];
		recipient =
			!fixedOutcome &&
			reporter.leader == outcome &&
			reporter.beneficiary != address(0) &&
			reporter.rewardCapAttoEth != 0
				? reporter.beneficiary
				: services;
		SecurityPoolPortfolioSettlement settlement = root.settlement();
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(pool.universeId()), pool.questionId());
		cashAttoEth = settlement.quoteRedemption(poolAddress, question.rewardShares);
		if (recipient != services) cashAttoEth = Math.min(cashAttoEth, reporter.rewardCapAttoEth);
	}
	function registerGame(address game) external onlyServices {
		if (reportingBeneficiaries[game].registered) return;
		// An interrupted parent's reporting work cannot earn one bounty per child.
		// Child rewards need a new local report; unclaimed inherited budgets remain funded.
		(reportingBeneficiaries[game].leader, ) = _leader(game);
		reportingBeneficiaries[game].registered = true;
		reportingBeneficiaries[game].rewardCapAttoEth = type(uint256).max;
	}
	function recordReporter(address game, address reporter) external onlyServices {
		Reporter storage record = reportingBeneficiaries[game];
		require(record.registered && reporter != address(0), 'Invalid reporter service');
		(BinaryOutcomes.BinaryOutcome leader, uint256 margin) = _leader(game);
		if (leader != record.leader) {
			SecurityPoolCapitalLedger capital = IPortfolioServiceRoot(portfolio).capitalLedger(EscalationGame(payable(game)).securityPool().universeId());
			// Even a coalition owning all winner rewards and backing income cannot
			// recover the native 2/5 median-stake burn. A round trip raises that median
			// by at least its temporary leader's margin; min-stake surplus alone is
			// recoverable, so the start bond by itself is not a safe economic bound.
			// Sub-bond deposits only fill the threshold: a return then forces a fork.
			uint256 risk = Math.min(EscalationGame(payable(game)).startBondAttoRep(), margin) / 5;
			uint256 cap = capital.isPriceValid() ? Math.mulDiv(risk, 1 ether, capital.conservativePrice()) : 0;
			record.rewardCapAttoEth = Math.min(record.rewardCapAttoEth, cap);
			record.leader = leader;
			record.beneficiary = leader == BinaryOutcomes.BinaryOutcome.None ? address(0) : reporter;
		}
	}
	function _leader(address game) private view returns (BinaryOutcomes.BinaryOutcome leader, uint256 margin) {
		uint256[3] memory balances = EscalationGame(payable(game)).getOutcomeBalancesAttoRep();
		uint256 highest;
		uint256 second;
		leader = BinaryOutcomes.BinaryOutcome.None;
		for (uint8 i; i < 3; i++) {
			if (balances[i] > highest) {
				second = highest;
				highest = balances[i];
				leader = BinaryOutcomes.BinaryOutcome(i);
			} else {
				second = Math.max(second, balances[i]);
				if (balances[i] == highest) leader = BinaryOutcomes.BinaryOutcome.None;
			}
		}
		unchecked {
			margin = highest - second;
		}
	}
}
