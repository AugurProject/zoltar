import Inv48BountyGuardFrameSource
import Inv48CloneGettersWrappers
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem noneDecl (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) t c r (.varDecl .uint256 name none) =
      pure (.normal (r.declareLocal name (.word 0))) := by
  simpa only [Ty.defaultValue] using Inv48.CloneGetters.decl_none n t c r .uint256 name

theorem innerFrame (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (tail : LocalEnv) (shape : r.locals = [(hoist,.word 0)]::tail)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r (.block inner)) trace (.normal final)) :
    ∃ w, final.locals = [(hoist,w)]::tail := by
  cases n with
  | zero =>
    obtain ⟨inside,exec,eq⟩ := blockNormal 0 t c r final inner trace run
    obtain ⟨mid,bt,aft,_,first,last⟩ := sequenceNormal 0 t c _ inside _ _ trace exec
    rw [Stmt.eval] at first
    cases first
  | succ n =>
    obtain ⟨inside,exec,eq⟩ := blockNormal (n+1) t c r final inner trace run
    obtain ⟨a,t1,t2,_,decl,rest⟩ := sequenceNormal (n+1) t c _ inside _ _ trace exec
    obtain ⟨arg,_,da⟩ := declarationNormal n t c _ a .uint256 "_ic_arg_0" argExpr
      (cleanupVarFrozen c r.pushScope "callbackGasLimit" 256) t1 decl
    obtain ⟨b,t3,t4,_,declRet,rest⟩ := sequenceNormal (n+1) t c a inside _ _ t2 rest
    rw [noneDecl] at declRet
    have db := (pureResult _ _ _ declRet).2
    cases db
    have bs : (a.declareLocal ret (.word 0)).locals =
        [(ret,.word 0),("_ic_arg_0",arg)]::[(hoist,.word 0)]::tail := by
      simp [da,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,shape]
    obtain ⟨d,t5,t6,_,call,rest⟩ := sequenceNormal (n+1) t c _ inside _ _ t4 rest
    have callShape : ∃ v, d.locals = [(ret,v),("_ic_arg_0",arg)]::[(hoist,.word 0)]::tail := by
      cases n with
      | zero =>
        unfold capture at call
        rw [Stmt.eval] at call
        change ExecutesOK (Stmt.eval 0 t c _ _ >>= _) _ _ at call
        rw [Stmt.eval] at call
        cases call
      | succ n =>
        obtain ⟨result,arguments⟩ := refVarsFrozen (Expr.listEvalFuel [.var "_ic_arg_0"]) c
          (a.declareLocal ret (.word 0)) ["_ic_arg_0"]
        change Expr.evalRefArgList c (a.declareLocal ret (.word 0)) [.var "_ic_arg_0"] = _ at arguments
        cases result with
        | error err =>
          rw [Stmt.eval] at call
          change ExecutesOK (Stmt.eval (n+1) t c _ (.internalCall [ret] key [.var "_ic_arg_0"]) >>= _) _ _ at call
          rw [Stmt.eval] at call
          dsimp only at call
          rw [arguments] at call
          cases err <;> cases call
        | ok values =>
          exact capturedHead n t c _ key _ values arguments _ _ bs t5 d call
    obtain ⟨v,ds⟩ := callShape
    obtain ⟨e,t7,t8,_,copied,done⟩ := sequenceNormal (n+1) t c d inside _ _ t6 rest
    rw [Stmt.evalList] at done
    have endEq := (pureResult _ _ _ done).2
    cases endEq
    obtain ⟨w,es⟩ := copyOuter n t c d inside v arg tail ds t7 copied
    exact ⟨w,by simp [eq,Runtime.popScope,es]⟩
end Inv48.BountyGuardFrame
