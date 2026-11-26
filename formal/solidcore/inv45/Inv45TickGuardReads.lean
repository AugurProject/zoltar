import Inv45SumSource
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

def readTickExpr := Source.Expr.castOp .uintCleanup 120 (getterMember 4)
def positiveExpr := Source.Expr.binary .ne (.castOp .uintCleanup 120 (.var "#read1610")) (.castOp .uintCast 120 (.word 0))
def sumMatches := Source.Expr.binary .eq (.castOp .uintCleanup 256 (.var "sum")) (.castOp .uintCleanup 256 (.var "#read1617"))

theorem readTick (c : Context) (r : Runtime) (q n : Nat) (N : n<Answer.radix)
    (fields : c.storageFields=model.core.storageFields) (look : r.lookupLocal? "questionId"=some (.word q))
    (stored : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n) :
    Expr.eval c r readTickExpr=pure (.word n,r) := by
  have slot := (storageArguments c r q fields).1
  have load : r.loadStorageBasePath c (.field "questions") [.word q,.word 4]=.ok (.word n) := by
    rw [slot]
    simpa [State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,StorageLayout.depth,packedStorageValueFromWord?,
      Ty.storageValueFromWord?,stored]
  exact uintMemberEval c r q 4 _ _ 120 (by decide) look load (clean120 c n N)

theorem positiveRead (c : Context) (r : Runtime) (n : Nat) (pos : 0<n) (N : n<Answer.radix)
    (look : r.lookupLocal? "#read1610"=some (.word n)) : Inv40.Reads c r positiveExpr 1 := by
  have wide : n<R := lt_trans N (by decide)
  have left : Inv40.Reads c r (.castOp .uintCleanup 120 (.var "#read1610")) n := by
    intro fuel enough
    change 2≤fuel at enough
    obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le' enough
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ look]
    simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,clean120 c n N]
  have right := Inv08.Authority.castBits (Inv08.Authority.literal c r 0 (by decide)) 120 (by decide) (by decide) (by decide)
  apply Inv08.ReleaseQuote.binary left right .ne (by intro h;cases h) (by intro h;cases h)
  change Except.ok (ε:=RevertData) (Value.word (boolWord (!wordEq n 0)))=_
  simp [wordEq,boolWord,show Shared.norm n=n from Nat.mod_eq_of_lt wide,show Shared.norm 0=0 from rfl,Nat.ne_of_gt pos]
theorem sumMatchRead (c : Context) (r : Runtime) (n : Nat) (N : n<R)
    (a : r.lookupLocal? "sum"=some (.word n)) (b : r.lookupLocal? "#read1617"=some (.word n)) :
    Inv40.Reads c r sumMatches 1 := by
  apply Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean (Inv08.localReads _ _ _ _ a) N)
    (Inv08.ReleaseQuote.readClean (Inv08.localReads _ _ _ _ b) N) .eq (by intro h;cases h) (by intro h;cases h)
  simpa using Inv32WideGuards.eqWord c.checked n n N N
#print axioms positiveRead
end Inv45.Public
