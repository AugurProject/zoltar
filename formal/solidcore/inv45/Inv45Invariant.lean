import Inv45ScalarCall
import Inv45Answer
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45
/-- The complete numerical and textual scalar specification, independently of storage. -/
theorem scalarSpecification (lo hi : Int) (n : Nat) (unit : List Nat) (rise : lo<hi) (pos : 0<n) :
    Function.Injective (fun k => Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) ∧
    Monotone (Scale.display lo (hi-lo).toNat n) ∧
    Scale.display lo (hi-lo).toNat n 0=lo ∧ Scale.display lo (hi-lo).toNat n n=hi :=
  ⟨fun x y e=>Text.labelDistinct lo hi n unit x y rise pos e, Scale.monotone _ _ _,
    Scale.leftEndpoint _ _ _,Scale.rightEndpoint _ _ _ rise pos⟩
/-- The generated scalar library returns the specified label for each valid tick. -/
theorem scalarExecution (fuel : Nat) (c : Context) (r : Runtime) (pid uid n k : Nat) (lo hi : Int) (unit : List Nat)
    (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi) (N : n<Answer.radix) (pos : 0<n) (valid : k≤n)
    (array : r.loadMemory? pid=some (.fixedArray [.word (n-k),.word k])) (str : r.loadMemory? uid=some (.bytes unit))
    (pbound : pid<r.nextMemory) (bound : uid<r.nextMemory) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    (∃after out, Bytes.Retains r after ∧ Decimal.Holds after
      (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      Stmt.eval (fuel+103) model.core.table c (Scalar.entry r pid uid n lo hi (.bytes [])) Scalar.fn.body=pure (.returned after [out])) ∧
    Answer.encode n k<2^256 ∧ Answer.encode n k >>> 255=1 ∧
    Answer.encode n k &&& (2^120-1)=k ∧ (Answer.encode n k >>> 120) &&& (2^120-1)=n-k ∧
    Answer.encode n k &&& ((2^15-1) <<< 240)=0 ∧
    Function.Injective (fun tick=>Text.label (Scale.display lo (hi-lo).toNat n tick) unit n (Scale.tag (hi-lo).toNat n tick)) ∧
    Monotone (Scale.display lo (hi-lo).toNat n) ∧
    Scale.display lo (hi-lo).toNat n 0=lo ∧ Scale.display lo (hi-lo).toNat n n=hi := by
  have wordFit : n<R := lt_trans N (by decide)
  exact ⟨Scalar.execution fuel c r pid uid n k lo hi unit L H rise wordFit pos valid array str pbound bound len sane cap,
    Answer.fit n k N valid,Answer.high n k N valid,Answer.low n k N valid,Answer.midpoint n k N valid,
    Answer.reserved n k N valid,scalarSpecification lo hi n unit rise pos⟩
#print axioms scalarExecution
#print axioms Scalar.call
end Inv45
