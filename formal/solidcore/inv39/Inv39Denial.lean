import Inv39Authority
import Inv39CapNecessity
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39
theorem notAuthorized (c : Context) (t : FunctionTable) (r : Runtime) (n : Nat)
    (layout : c.immutableFields=model.core.context.immutableFields) (word : c.sender<R)
    (owner : Nat) (ownerFit : owner<R) (neq : c.sender≠owner) (holds : r.state.immutable? "zoltar"=some (.word owner)) :
    Stmt.eval (n+1) t c r authorityGuard = pure (.reverted r (.error "ReputationToken caller must be the Zoltar contract")) := by
  have fields : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩ := by
    change c.immutableFields.find? _ = _
    rw [layout]; exact immutableLayout
  have read : Expr.evalFuel 3 c r (.immutable "zoltar") = pure (.word owner,r) := by
    rw [Expr.evalFuel]
    simp [Runtime.loadImmutableField,fields,holds,Ty.coerceValue?]
    rfl
  have equal := Inv32WideGuards.eqWord c.checked c.sender owner word ownerFit
  simp only [if_neg neq] at equal
  have cond : authorityCheck.eval c r = pure (.word (boolWord false),r) :=
    Inv32Eval.binary 3 c r .eq (by intro h; cases h) (by intro h; cases h) .caller (.immutable "zoltar") (.word c.sender) (.word owner) (.word (boolWord false))
      (by rw [Expr.evalFuel]) read equal
  exact Inv32QuoteGuard.requireEval _ _ _ _ _ false _ cond
namespace Child
theorem wrongCaller (k : Kind) (s : State) (sender self a v owner : Nat) (fit : v<R) (senderFit : sender<R)
    (ownerFit : owner<R) (neq : sender≠owner) (holds : s.immutable? "zoltar"=some (.word owner)) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (entryName k)) (callContext sender self) s [.word a,.word v] =
      some (.reverted s (.error "ReputationToken caller must be the Zoltar contract")) := by
  let c := callContext sender self
  let t := model.core.table
  let r := CheckedWordCall.initial c s
  let start := enter r a v
  let outer := start.pushScope
  let middle := outer.pushScope
  let inner := middle.pushScope
  let err := RevertData.error "ReputationToken caller must be the Zoltar contract"
  have guard := notAuthorized c t inner 49996 rfl senderFit owner ownerFit neq holds
  have modBlock := Inv32Revert.blockRevert 49997 t c middle inner _ err
    (Inv32Revert.stop _ _ _ _ _ _ [Stmt.captureReturn [] (effects k).value] _ guard)
  have group := Inv32Revert.blockRevert 49998 t c outer inner.popScope _ err (Inv32Revert.stop _ _ _ _ _ _ [] _ modBlock)
  have skip : Stmt.eval 49999 t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec 49998 t c outer "valueAttoRep" v fit rfl (by dsimp [outer,start,enter]; write_param)
  have ev := Inv32Revert.blockRevert 49999 t c start inner.popScope.popScope _ err
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ param).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ group)))
  exact dispatchRejected k _ _ _ _ _ _ _ ev
end Child
end Inv39
