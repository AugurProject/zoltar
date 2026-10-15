// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolVaultPositionReceiver } from '../../statoblast/interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from '../../statoblast/interfaces/ISecurityPoolForker.sol';
import { BinaryOutcomes } from '../../statoblast/BinaryOutcomes.sol';

interface ISecurityPoolPositionStake {
	function depositToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep) external;
}

/// @dev Consent and owner-call adapter for tests exercising actual native pool accounting.
contract SecurityPoolPositionReceiver is ISecurityPoolVaultPositionReceiver {
	address public immutable owner;
	ISecurityPool public immutable pool;
	address public immutable acceptedSource;
	address public consentStaker;
	uint256 public consentStakeAttoRep;

	constructor(address _owner, ISecurityPool _pool, address _acceptedSource) {
		owner = _owner;
		pool = _pool;
		acceptedSource = _acceptedSource;
	}

	function onSecurityPoolVaultPositionReceived(address source) external returns (bytes4) {
		require(msg.sender == address(pool) && source == acceptedSource, 'Position source not accepted');
		if (consentStakeAttoRep > 0)
			SecurityPoolPositionReceiver(payable(source)).stakeDuringConsent(consentStakeAttoRep);
		return ISecurityPoolVaultPositionReceiver.onSecurityPoolVaultPositionReceived.selector;
	}

	function configureConsentStake(address staker, uint256 amountAttoRep) external {
		require(msg.sender == owner, 'Only owner');
		consentStaker = staker;
		consentStakeAttoRep = amountAttoRep;
	}

	function stakeDuringConsent(uint256 amountAttoRep) external {
		require(msg.sender == consentStaker, 'Only consent staker');
		ISecurityPoolPositionStake(address(pool)).depositToEscalationGame(BinaryOutcomes.BinaryOutcome.Yes, amountAttoRep);
	}

	function split(address recipient, uint256 numerator, uint256 denominator) external {
		require(msg.sender == owner, 'Only owner');
		pool.splitVaultPosition(recipient, numerator, denominator);
	}

	function migrate(uint256 outcome) external {
		require(msg.sender == owner, 'Only owner');
		ISecurityPoolForker(pool.securityPoolForker()).migrateVault(pool, outcome);
	}

	receive() external payable {}
}
