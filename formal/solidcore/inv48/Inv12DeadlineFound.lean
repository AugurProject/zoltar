import Inv12DeadlineGetter
import Inv12GetterFrame
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem Deadline.found (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (root addr : Nat) (data : Source.Expr) (bytes : List Source.Byte)
    (E : data.evalWithRuntimeByContext c (getterStart r 0)=.ok (.bytes bytes,getterStart r 0))
    (clean : bytes.map normByte=bytes)
    (rows : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (field : r.loadImmutableField c "zoltar"=.ok (.word root))
    (fit : addr<Inv32Division.R) (size : root<Inv32Division.R) (away : wordEq root c.self=false) (ok : out.success=true)
    (ans : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .staticcall root bytes 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word addr]) :
    (Stmt.eval (n+2) t c (getterStart r 0) (Deadline.readWord data)).runWith rows=.ok (.normal (getterStart (Deadline.wordReply c r root bytes out) addr)) := by
  let base := Deadline.wordReply c r root bytes out
  let next := (getterStart base addr).withFrame [("__ext0",.word addr)]
  have set : ((Deadline.wordReply c (getterStart r 0) root bytes out).withFrame [("__ext0",.word addr)]).assignLocal?
      Inv03.Bodies.tmp (.word addr)=some next := by
    simp [Deadline.wordReply,replied,getterStart,next,base,Runtime.recordExternalInteraction,Runtime.pushScope,
      Runtime.withFrame,Runtime.declareLocal,Runtime.assignLocal?,LocalEnv.declare,LocalEnv.assign?,
      Frame.assign?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Value.coerceLike?,Inv03.Bodies.tmp,Inv32CeilFlags.h0]
  have read : (Source.Expr.immutable "zoltar").evalWithRuntimeByContext c (getterStart r 0)=.ok (.word root,getterStart r 0) := by
    have ev : (Expr.immutable "zoltar").eval c (getterStart r 0)=pure (.word root,getterStart r 0) := by
      unfold Expr.eval;rw [Expr.evalFuel]
      have field' : (getterStart r 0).loadImmutableField c "zoltar"=.ok (.word root) := field
      rw [field'];rfl
    unfold Expr.evalWithRuntimeByContext;rw [ev];rfl
  exact Deadline.readWordRun n t c (getterStart r 0) root addr rows out data bytes E clean read fit size away ok ans decoded rfl next set
end Inv12
