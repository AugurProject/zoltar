// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';

contract PriceOracleManagerAndOperatorQueuerFactory {
	function deployPriceOracleManagerAndOperatorQueuer(OpenOracle _openOracle, ReputationToken _reputationToken, bytes32 salt) external returns (PriceOracleManagerAndOperatorQueuer) {
		return new PriceOracleManagerAndOperatorQueuer{ salt: keccak256(abi.encodePacked(msg.sender, salt)) }(_openOracle, _reputationToken);
	}
}
