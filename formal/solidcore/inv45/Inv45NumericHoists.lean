import Inv45ScalarInputs
import Inv45ScalarText
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
theorem copySigned (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (dst src : String) (old v : Nat)
    (D : r.lookupLocal? dst=some (.int old)) (S : r.lookupLocal? src=some (.int v))
    (put : r.assignLocal? dst (.int v)=some next) :
    Stmt.eval (n+1) t c r (.assign (.var dst) (.var src))=pure (.normal next) := by
  have ds : r.lookupMemoryRef? dst=none := by simp [Runtime.lookupMemoryRef?,D]
  have ss : r.lookupStorageBase? src=none := by simp [Runtime.lookupStorageBase?,S]
  have rd : Expr.eval c r (.var src)=pure (.int v,r) := readSignedLocal _ _ _ _ S _ (Nat.le_succ _)
  have place : (LValue.var dst).resolveWithRuntime c r=pure (.local dst,r) := by
    have ns : r.lookupStorageBase? dst=none := by simp [Runtime.lookupStorageBase?,D]
    change Expr.resolveLValueFuel 2 c r (.var dst)=_;rw [Expr.resolveLValueFuel,ns,D]
  rw [Stmt.eval];dsimp only
  simp only [ds,LValue.wantsMemoryRefRhs,Option.isSome_none,if_false,Bool.false_eq_true,rd,ss]
  change (do match ← ((LValue.var dst).resolveWithRuntime c r).caught with
    | .ok (target,r')=>match target.write c r' (.int v) with | .ok updated=>pure (Result.normal updated) | .error err=>pure (Result.reverted r err)
    | .error err=>pure (Result.reverted r err))=_
  rw [place]
  change (match (ResolvedLValue.local dst).write c r (.int v) with
    | .ok updated=>(pure (.normal updated) : SolI Result) | .error err=>pure (.reverted r err))=_
  simp [ResolvedLValue.write,put]
macro "scalarlocals" : tactic => `(tactic|
  simp [Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,Runtime.assignLocalRaw?,
    Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,
    LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Format.temp0,mulSlot,addSlot])
theorem mulHoist (fuel : Nat) (c : Context) (r : Runtime) (k d n : Nat) (K : k<R) (D : d<R) (N : n<R) (pos : 0<n)
    (fit : k*d/n<R) (pay : r.lookupLocal? "payout"=some (.word k)) (delta : r.lookupLocal? "diffU"=some (.word d))
    (ticks : r.lookupLocal? "numTicks"=some (.word n)) :
    Stmt.eval (fuel+11) model.core.table c (r.declareLocal Format.temp0 (.word 0)) mul.value=
      pure (.normal (r.declareLocal Format.temp0 (.word (k*d/n)))) := by
  let t := model.core.table
  let s := r.declareLocal Format.temp0 (.word 0)
  let a := s.pushScope.declareLocal "_ic_arg_0" (.word k)
  let b := a.declareLocal "_ic_arg_1" (.word d)
  let arg := b.declareLocal "_ic_arg_2" (.word n)
  let mid (base : Runtime) (result : Nat) := base.withFrame [(mulSlot,.word result),("_ic_arg_2",.word n),("_ic_arg_1",.word d),("_ic_arg_0",.word k)]
  let dst := r.declareLocal Format.temp0 (.word (k*d/n))
  have arg0 := Add.declareWord (fuel+9) t "_ic_arg_0" (MulDiv.wordVar c s.pushScope "payout" k K (by simpa [s,pushLookup,declLookup,Format.temp0] using pay))
  have arg1 := Add.declareWord (fuel+9) t "_ic_arg_1" (MulDiv.wordVar c a "diffU" d D (by simpa [a,s,pushLookup,declLookup,Format.temp0] using delta))
  have arg2 := Add.declareWord (fuel+9) t "_ic_arg_2" (MulDiv.wordVar c b "numTicks" n N (by simpa [a,b,s,pushLookup,declLookup,Format.temp0] using ticks))
  have init := Inv32FloorStart.zero (fuel+9) t c arg mulSlot
  have res := MulDiv.call (fuel+1) c (mid s 0) k d n "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" [mulSlot] K D N pos fit rfl rfl rfl
  have assigned : internalCallAssign (mid s 0) [mulSlot] [.word (k*d/n)]=pure (.normal (mid s (k*d/n))) := by
    dsimp [internalCallAssign,mid];scalarlocals
  have read := Inv32Internal.capture (fuel+9) t c (mid s 0) (mid s (k*d/n)) [mulSlot] _ (res.trans assigned)
  have temp : (mid s (k*d/n)).lookupLocal? Format.temp0=some (.word 0) := by
    cases H : r.locals <;> simp [mid,s,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Format.temp0,mulSlot,H]
  have write : (mid s (k*d/n)).assignLocal? Format.temp0 (.word (k*d/n))=some (mid dst (k*d/n)) := by
    cases H : r.locals <;> simp [mid,s,dst,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,
      LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,Format.temp0,mulSlot,H]
  have copy := Inv32Temps.copy (fuel+9) t c _ _ Format.temp0 mulSlot 0 (k*d/n) temp rfl write
  apply Inv32Hoist.block (fuel+10) t c s (mid dst (k*d/n)) _
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg0).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg1).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ arg2).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ read).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
  change Stmt.evalList (fuel+10) _ _ _ []=_;rw [Stmt.evalList]
end Inv45.Scalar
