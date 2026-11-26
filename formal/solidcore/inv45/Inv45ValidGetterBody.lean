import Inv45PublicEnvelope
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
theorem validGetterBody (fuel : Nat) (c : Context) (r : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (Q : q<R)
    (scalar : r.state.loadSlot (labelsSlot q)=0)
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none)
    :
    ∃ after out, Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      Source.Stmt.eval (fuel+116) model.core.table c (entry r q (Answer.encode n k)) getter.body=pure (.returned after [out]) := by
  let prepared := (readyEntry r q (Answer.encode n k)).pushScope.pushScope
  have decode := validPrefixExecution (fuel+80) c prepared n k N valid rfl
  obtain ⟨guard,yes,no,after,out,src,holds,branch⟩ := finishScalarBranch fuel c prepared q n k lo hi unit
    fields rfl scalar ticks low high bytes N L H rise pos valid len sane cap decode
  have body := runEnvelope _ c r q (Answer.encode n k) Q (Answer.fit n k N valid) guard yes no src after out branch
  refine ⟨_,out,?_,body⟩
  cases holds with
  | direct => exact .direct
  | ref h cell => exact .ref h cell
#print axioms validGetterBody
end Inv45.Public
