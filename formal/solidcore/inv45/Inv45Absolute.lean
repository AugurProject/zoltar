import Inv45AbsExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv08.Authority
namespace Inv45.Shapes
def absoluteFrame (v : Int) : Frame := [("value",.int (Signed.word v)),("_ret0",.word 0)]
theorem assignInput (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (v : Int) (valid : Signed.inRange v) (localV : r.lookupLocal? "value"=some (.int (Signed.word v)))
    (store : r.assignLocal? "value" (.int (Signed.word v))=some r) :
    Stmt.eval (fuel+1) t c r (.assign (.var "value") (signedCast value).value) = pure (.normal r) := by
  have notMem : (LValue.var "value").wantsMemoryRefRhs r=false := by
    simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,localV]
  have ev : Expr.eval c r (signedCast value).value=pure (.int (Signed.word v),r) :=
    intClean (readSignedLocal _ _ _ _ localV) valid _ (by decide)
  have resolved : (LValue.var "value").resolveWithRuntime c r = pure (.local "value",r) := by
    have noRef : r.lookupStorageBase? "value"=none := by simp [Runtime.lookupStorageBase?,localV]
    change Expr.resolveLValueFuel ((Expr.var "value").orderFuel+1) c r (.var "value") = _
    rw [Expr.resolveLValueFuel,noRef,localV]
  rw [Stmt.eval];dsimp only;rw [notMem]
  simp only [Bool.false_eq_true,if_false,ev]
  change (do
    match ← ((LValue.var "value").resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.int (Signed.word v)) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolved]
  change (match (ResolvedLValue.local "value").write c r (.int (Signed.word v)) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err))=_
  have ok : (ResolvedLValue.local "value").write c r (.int (Signed.word v))=.ok r := by simp [ResolvedLValue.write,store]
  rw [ok]
private theorem inner (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Int)
    (valid : Signed.inRange v) (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Stmt.evalList (fuel+4) t c r
      [.ifElse nonnegative.value (.returnValues [positive.value]) .skip,
       .unchecked (.block [.returnValues [mag.value]])] = pure (.returned r [.word v.natAbs]) := by
  have cond := conditionReads c r v valid localV (nonnegative.value.orderFuel+1) (by omega)
  by_cases pos : 0≤v
  · rw [if_pos pos] at cond
    have ret := Inv32CompareValues.retOne (fuel+2) t c r positive.value _ (positiveReads _ _ _ valid pos localV _ (by omega))
    have branch := Inv32Blocks.branch (fuel+3) t c r nonnegative.value (.returnValues [positive.value]) .skip true cond
    rw [Stmt.evalList,branch];simp only [ite_true,ret,bindPure]
  · rw [if_neg pos] at cond
    have branch := Inv32Blocks.branch (fuel+3) t c r nonnegative.value (.returnValues [positive.value]) .skip false cond
    have sk : Stmt.eval (fuel+3) t c r .skip = pure (.normal r) := by rw [Stmt.eval]
    let ctx := {c with checked:=false}
    have lookup : r.pushScope.lookupLocal? "value"=some (.int (Signed.word v)) := localV
    have ret := Inv32CompareValues.retOne (fuel+1) t ctx r.pushScope mag.value _
      (negativeReads _ _ _ valid (by omega) rfl lookup _ (by omega))
    have block : Stmt.eval (fuel+3) t ctx r (.block [.returnValues [mag.value]])=pure (.returned r [.word v.natAbs]) := by
      rw [Stmt.eval];dsimp only;rw [Stmt.evalList,ret];rfl
    have uncheckedBlock : Stmt.eval (fuel+4) t c r (.unchecked (.block [.returnValues [mag.value]]))=pure (.returned r [.word v.natAbs]) := by
      rw [Stmt.eval];exact block
    rw [Stmt.evalList,branch];simp only [Bool.false_eq_true,if_false,sk,bindPure]
    rw [Stmt.evalList,uncheckedBlock];rfl

theorem absoluteExecution (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (v : Int) (valid : Signed.inRange v) :
    Stmt.eval (fuel+6) t c (r.withFrame (absoluteFrame v)) absoluteFn.body =
      pure (.returned (r.withFrame (absoluteFrame v)) [.word v.natAbs]) := by
  let s := r.withFrame (absoluteFrame v)
  have norm : Shared.norm (Signed.word v)=Signed.word v := Nat.mod_eq_of_lt (Signed.wordFit _ valid)
  have st : s.pushScope.assignLocal? "value" (.int (Signed.word v))=some s.pushScope := by
    simp [s,absoluteFrame,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Runtime.assignLocalRaw?,Value.coerceLike?,norm]
  have set := assignInput (fuel+4) t c s.pushScope v valid rfl st
  have skip : Stmt.eval (fuel+5) t c s.pushScope .skip = pure (.normal s.pushScope) := by rw [Stmt.eval]
  have tail := inner fuel t c s.pushScope.pushScope v valid rfl
  have b : Stmt.eval (fuel+5) t c s.pushScope (.block [
      .ifElse nonnegative.value (.returnValues [positive.value]) .skip,
      .unchecked (.block [.returnValues [mag.value]])])= pure (.returned s.pushScope [.word v.natAbs]) := by
    rw [Stmt.eval];dsimp only;rw [tail];rfl
  rw [absoluteSource]
  change Stmt.eval (fuel+6) t c s (.block [.assign (.var "value") (signedCast value).value,.skip,_])=_
  rw [Stmt.eval];dsimp only;rw [Stmt.evalList,set];simp only [bindPure]
  rw [Stmt.evalList,skip];simp only [bindPure]
  change Stmt.eval (fuel+5) t c s.pushScope (Inv03.Bodies.block [Inv32Shapes.Stmt_ifElse nonnegative (Inv03.Bodies.ret positive) Inv32Shapes.Stmt_skip, Inv32Shapes.Stmt_unchecked (Inv03.Bodies.block [Inv03.Bodies.ret mag])]).value = _ at b
  rw [Stmt.evalList,b];rfl
end Inv45.Shapes
