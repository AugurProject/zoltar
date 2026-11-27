import Inv03HarnessBindings

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv03

def feeBudget (state : State) (q s rate net total : Nat) :=
  CheckedWordCall.read model state "feeBudget" (Harness.args q s rate net total)

/-- The external Solidity call returns the largest removable weight at the quoted
book price. The constructor caps the minimum rate at 10^18. The book caps total
units below 2^128, and a question's units are included in the book total. -/
theorem maximumRemoval (state : State) (q s rate net total : Nat)
    (supplyWord : s<R) (rateBound : rate≤10^18) (netWord : net<R) (bookBound : total<2^128)
    (questionBound : q≤total) (netPositive : 0<net) (totalPositive : 0<total) :
    let floorCash := ceilQuot (s*rate) (10^18)
    ∃ b, feeBudget state q s rate net total = some b ∧
      (floorCash ≤ rawValue q net total →
        b≤q ∧ ∀ removed, removed≤q → (floorCash ≤ rawValue (q-removed) net total ↔ removed≤b)) ∧
      (rawValue q net total < floorCash → b=0) := by
  let cash := ceilQuot (s*rate) (10^18)
  let b := budget q cash net total
  have ht : total<R := lt_trans bookBound (by decide)
  have hq := lt_of_le_of_lt questionBound ht
  have hr : rate<R := lt_of_le_of_lt rateBound (by decide)
  obtain ⟨hc,scaled,hv,_⟩ := wordBounds q s rate net total rateBound supplyWord totalPositive bookBound
    netPositive questionBound netWord
  let c := CheckedWordCall.ctx model
  have ev := Harness.execute 49965 c (CheckedWordCall.initial c state) q s rate net total
    hq supplyWord hr netWord ht netPositive totalPositive hc scaled hv
  rw [← Harness.checkedBody] at ev
  exact ⟨b,CheckedWordCall.returnsWord model Harness.fn "feeBudget" state _ _ b
    (Option.some_get _).symm (Harness.frameOk _ _ _ _ _) Harness.returns Harness.accepts ev,
    maximal q s rate net total netPositive totalPositive⟩
end Inv03

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv03.maximumRemoval do
    unless allowed.contains dep do throwError "Unexpected INV-03 axiom {dep}"
