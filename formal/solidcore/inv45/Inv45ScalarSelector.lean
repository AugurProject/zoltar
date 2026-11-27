import Inv45ValidGetterBody
import Inv45PublicReturnCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

private theorem sameBytes (s t : State) (eqn : s.storage=t.storage) (slot : Nat) :
    s.loadStorageBytesAt slot=t.loadStorageBytesAt slot := by
  have slots (key : Nat) : s.loadSlot key=t.loadSlot key := by simp [State.loadSlot,eqn]
  have long (count i : Nat) : s.loadStorageBytesLongSlots slot i count=t.loadStorageBytesLongSlots slot i count := by
    induction count generalizing i with
    | zero => rfl
    | succ n ih => simp only [State.loadStorageBytesLongSlots,slots,ih]
  simp only [State.loadStorageBytesAt,slots,long]

def labelFor (lo hi : Int) (unit : List Nat) (n k : Nat) :=
  Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)

theorem validScalarCall (fuel : Nat) (st : State) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (Q : q<R)
    (scalar : st.loadSlot (labelsSlot q)=0)
    (ticks : wordBitRange 96 120 (st.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (st.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (st.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : st.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
 :
    ∃ final, model.callTree (fuel+116) (.selector 2895153088) st [.word q,.word (Answer.encode n k)] =
      some (pure (.returned final [.bytes (labelFor lo hi unit n k)])) := by
  let c := model.core.context
  let rt := {publicEntry c st q (Answer.encode n k) with locals:=[]}
  obtain ⟨after,out,holds,body⟩ := validGetterBody fuel c rt q n k lo hi unit rfl Q scalar ticks low high
    ((sameBytes rt.state st rfl _).trans bytes) N L H rise pos valid len sane rfl
  exact ⟨_,selectorCall _ st q _ after _ out rfl body holds⟩
#print axioms validScalarCall
end Inv45.Public
