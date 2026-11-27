import Inv45GetterMemoryArgs
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

theorem checkedStorageExpressions (c : Context) (r : Runtime) (q n : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields) (look : r.lookupLocal? "questionId"=some (.word q))
    (N : n<R) (L : Signed.inRange lo) (H : Signed.inRange hi)
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit) :
    Expr.eval c r (.castOp .uintCleanup 256 (getterMember 4))=pure (.word n,r) ∧
    Expr.eval c r (.castOp .intCleanup 256 (getterMember 5))=pure (.int (Signed.word lo),r) ∧
    Expr.eval c r (.castOp .intCleanup 256 (getterMember 6))=pure (.int (Signed.word hi),r) ∧
    Expr.eval c r unitArgument=pure (.bytes unit,r) := by
  obtain ⟨a,b,d,e⟩ := readback c r q n lo hi unit fields ticks low high bytes
  exact ⟨uintMemberEval c r q 4 _ _ 256 (by decide) look a (Inv32Guards.cleanupWord c.checked n N),
    intMemberEval c r q 5 _ _ 256 (by decide) look b (Signed.clean c.checked lo L),
    intMemberEval c r q 6 _ _ 256 (by decide) look d (Signed.clean c.checked hi H),
    unitEval c r q unit look e⟩
#print axioms checkedStorageExpressions
end Inv45.Public
