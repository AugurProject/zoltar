import Inv45ScalarSelector
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

/-- Every valid tick of one stored scalar question returns its specified label
through the public selector. The byte strings distinguish ticks even where the
numeric component is equal, and the numeric component attains both bounds. -/
theorem scalarLabels (fuel : Nat) (st : State) (q n : Nat) (lo hi : Int) (unit : List Nat)
    (Q : q<R)
    (scalar : st.loadSlot (labelsSlot q)=0)
    (ticks : wordBitRange 96 120 (st.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (st.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (st.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : st.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
 :
    (∀ k, k≤n → ∃ final, model.callTree (fuel+116) (.selector 2895153088) st [.word q,.word (Answer.encode n k)] =
      some (pure (.returned final [.bytes (labelFor lo hi unit n k)]))) ∧
    Function.Injective (labelFor lo hi unit n) ∧ Monotone (Scale.display lo (hi-lo).toNat n) ∧
      Scale.display lo (hi-lo).toNat n 0=lo ∧ Scale.display lo (hi-lo).toNat n n=hi := by
  exact ⟨fun k valid => validScalarCall fuel st q n k lo hi unit Q scalar ticks low high bytes N L H rise pos valid len sane,
    scalarSpecification lo hi n unit rise pos⟩
end Inv45.Public

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv45.Public.scalarLabels do
    unless allowed.contains dep do throwError "Unexpected INV-45 axiom {dep}"
#print axioms Inv45.Public.scalarLabels
