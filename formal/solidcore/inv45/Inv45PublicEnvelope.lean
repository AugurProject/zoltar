import Inv45BranchAssembly
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

def entry (r : Runtime) (q a : Nat) :=
  r.withFrame [("questionId",.word q),("answer",.word a),("_ret0",.bytes [])]
def readyEntry (r : Runtime) (q a : Nat) :=
  (Bytes.allocate r []).withFrame [("questionId",.word q),("answer",.word a),("_ret0",.memoryRef r.nextMemory)]
def restOfGetter := match getterShape.value with
  | .block [_,_,_,.block (_::tail)] => tail
  | _ => []
set_option maxRecDepth 8192 in
theorem envelope {guard : Source.Expr} {yes no : Source.Stmt}
    (found : firstDecision getter.body=some (guard,yes,no)) :
    getter.body=.block [Inv32FloorFastPath.cleanParam "questionId",Inv32FloorFastPath.cleanParam "answer",
      .memoryLocalize .bytesCalldata "_ret0",.block (.ifElse guard yes no::restOfGetter)] := by
  rw [getterSource] at found ⊢
  unfold firstDecision at found
  injection found with h
  cases h
  rfl

theorem runEnvelope (fuel : Nat) (c : Context) (r : Runtime) (q a : Nat)
    (Q : q<R) (A : a<R) (guard : Source.Expr) (yes no : Source.Stmt)
    (found : firstDecision getter.body=some (guard,yes,no)) (after : Runtime) (out : Value)
    (branch : Source.Stmt.eval fuel model.core.table c (readyEntry r q a).pushScope.pushScope
      (.ifElse guard yes no)=pure (.returned after [out])) :
    Source.Stmt.eval (fuel+2) model.core.table c (entry r q a) getter.body=pure (.returned after.popScope.popScope [out]) := by
  let t := model.core.table
  let s := (entry r q a).pushScope
  have cleanQ := Inv32FloorFastPath.cleanParamExec fuel t c s "questionId" q Q rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Shared.norm,Nat.mod_eq_of_lt Q])
  have cleanA := Inv32FloorFastPath.cleanParamExec fuel t c s "answer" a A rfl
    (by simp [s,entry,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Shared.norm,Nat.mod_eq_of_lt A])
  have loc : Source.Stmt.eval (fuel+1) t c s (.memoryLocalize .bytesCalldata "_ret0")=pure (.normal (readyEntry r q a).pushScope) := by
    rw [Source.Stmt.eval];rfl
  have inner := Inv32FloorFastPath.blockReturned fuel t c (readyEntry r q a).pushScope after _ [out]
    (Inv32FloorFastPath.stop _ _ _ _ _ _ restOfGetter _ branch)
  rw [envelope found]
  apply Inv32FloorFastPath.blockReturned
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cleanQ).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cleanA).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loc).trans
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inner
#print axioms runEnvelope
end Inv45.Public
