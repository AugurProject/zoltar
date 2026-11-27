import Inv01Generated

open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv01

private abbrev scale := 10^18
private abbrev maxWord := 2^256-1
private abbrev lastQuotient := maxWord / scale

private inductive Observation where
  | returned (v : Nat)
  | panic (code : Nat)
  deriving DecidableEq

private def observe (model : TypeCheck.CheckedContract) (name : String) (args : List Nat) :
    Option Observation := do
  let result ← TypeCheck.CheckedContract.call? 50000 model (.name name) State.empty (args.map Value.word)
  match result with
  | .returned _ [.word v] => some (.returned v)
  | .reverted _ (.panic code) => some (.panic code)
  | _ => none

/-- With unit commitment, target health 10,000 and multiplier 10,000*k,
the last backing increment takes the mathematical price above uint256. -/
private def boundaryAt (model : TypeCheck.CheckedContract) (k : Nat) : Bool :=
  let multiplier := 10000*k
  let backing := k*(lastQuotient+1)
  decide (
    observe model "requiredRep" [1,maxWord,multiplier,10000] = some (.returned backing) ∧
    observe model "maximumHealthyPrice" [backing-1,1,multiplier] = some (.returned (lastQuotient*scale)) ∧
    observe model "maximumHealthyPrice" [backing,1,multiplier] = some (.panic 0x11))

private def counterexample : Bool := Id.run do
  let .ok model := TypeCheck.CheckedInput.contract Inv01Generated.importedSourceUnit "SecurityPoolCommitmentIndex" | return false
  return boundaryAt model 1 && boundaryAt model 2

theorem unrestrictedBoundaryFails : lastQuotient*scale ≤ maxWord ∧ maxWord < (lastQuotient+1)*scale ∧
    2*(lastQuotient+1) < 2^256 ∧ counterexample = true := by native_decide

/-- Bounding REP by the protocol supply cap leaves room even for multiplier
and commitment equal to one. This rules out the inverse overflow above on
that domain and makes no claim about unrelated forward-quote overflows. -/
theorem boundedInverseFits (rep multiplier commitment : Nat)
    (hr : rep ≤ 11000000*10^18) (_hm : 0<multiplier) (_hc : 0<commitment) :
    rep*10000/multiplier < 2^256 ∧ (rep*10000/multiplier)*scale/commitment < 2^256 := by
  have base := Nat.le_trans (Nat.div_le_self (rep*10000) multiplier) (Nat.mul_le_mul_right 10000 hr)
  have price := Nat.le_trans (Nat.div_le_self ((rep*10000/multiplier)*scale) commitment)
    (Nat.mul_le_mul_right scale base)
  exact ⟨lt_of_le_of_lt base (by decide),lt_of_le_of_lt price (by decide)⟩

end Inv01

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv01.unrestrictedBoundaryFails,``Inv01.boundedInverseFits] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-01 axiom {dep}"
