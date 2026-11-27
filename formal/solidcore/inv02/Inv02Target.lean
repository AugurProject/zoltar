import Inv02IndexMath

open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv02

private def required (lots target : Nat) : Option Nat := do
  let .returned _ [.word v] ← TypeCheck.CheckedContract.call? 50000 indexModel
    (.name "requiredRep") State.empty [.word lots,.word (10^18),.word 20000,.word target] | none
  return v

/-- At this price and multiplier the protocol requires two REP units per lot.
An 11,000 bps owner target rounds 2.2 and 4.4 to three and five respectively. -/
theorem voluntaryTargetRoundsSeparately :
    required 1 10000 = some 2 ∧ required 2 10000 = some 4 ∧
    required 1 11000 = some 3 ∧ required 2 11000 = some 5 := by native_decide
end Inv02
