import Inv12ServiceLookup
open SolidCore.Solidity.Source
namespace Inv12

def getterStart (r : Runtime) (v : Nat) := r.pushScope.declareLocal Inv03.Bodies.tmp (.word v)

theorem immutableRoot (c : Context) (r : Runtime) (root : Nat)
    (field : r.loadImmutableField c "securityPool"=.ok (.word root)) :
    (Expr.immutable "securityPool").evalWithRuntimeByContext c r=.ok (.word root,r) := by
  have ev : (Expr.immutable "securityPool").eval c r=pure (.word root,r) := by
    unfold Expr.eval;rw [Expr.evalFuel];rw [field];rfl
  unfold Expr.evalWithRuntimeByContext;rw [ev];rfl

theorem serviceFound (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (root addr : Nat)
    (rows : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (field : r.loadImmutableField c "securityPool"=.ok (.word root))
    (size : root<Inv32Division.R) (away : wordEq root c.self=false) (ok : out.success=true)
    (ans : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .staticcall root (wireBytes serviceSelector []) 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.address] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word addr]) :
    (Stmt.eval (n+2) t c (getterStart r 0) rootGetter).runWith rows=.ok (.normal (getterStart (rootReply c r root out) addr)) := by
  let base := rootReply c r root out
  let next := (getterStart base addr).withFrame [("__ext0",.word addr)]
  have set : ((rootReply c (getterStart r 0) root out).withFrame [("__ext0",.word addr)]).assignLocal?
      Inv03.Bodies.tmp (.word addr)=some next := by
    simp [rootReply,replied,getterStart,next,base,Runtime.recordExternalInteraction,Runtime.pushScope,
      Runtime.withFrame,Runtime.declareLocal,Runtime.assignLocal?,LocalEnv.declare,LocalEnv.assign?,
      Frame.assign?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Value.coerceLike?,Inv03.Bodies.tmp,Inv32CeilFlags.h0]
  exact rootGetterRun n t c (getterStart r 0) root addr rows out (immutableRoot _ _ _ field) size away ok ans decoded rfl next set
end Inv12
