import Inv48ReportingGuardFrameFrozen
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem defaultNormal (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (ty : Ty) (name : String) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r (.varDecl ty name none)) trace (.normal final)) :
    final = r.declareLocal name ty.defaultValue := by
  rw [Stmt.eval] at run
  exact Result.normal.inj (pureResult _ _ _ run).2

theorem universeBlock (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (tail : Frame) (rest : LocalEnv)
    (shape : r.locals = ((hoist,.word 0)::tail)::rest) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+3) t c r universeP.value) trace (.normal final)) :
    ∃ value, final.locals = ((hoist,value)::tail)::rest := by
  obtain ⟨inner,body,pop⟩ := blockNormal (n+2) t c r final _ trace run
  obtain ⟨declared,bt,aft,_,decl,body⟩ := sequenceNormal (n+2) t c r.pushScope inner _ _ _ body
  have deq := defaultNormal (n+1) t c r.pushScope declared .uint256 ret bt decl
  subst declared
  obtain ⟨captured,bt,aft,_,call,assign⟩ := sequenceNormal (n+2) t c _ inner _ _ aft body
  have start : (r.pushScope.declareLocal ret Ty.uint256.defaultValue).locals =
      [(ret,.word 0)]::((hoist,.word 0)::tail)::rest := by
    simp [Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,shape,Ty.defaultValue]
  obtain ⟨value,ceq⟩ := universeCapture n t c _ captured [] _ 0 start bt call
  change ExecutesOK (Stmt.evalList (n+2) t c captured
    [.assign (.var hoist) (.var ret)]) aft (.normal inner) at assign
  rw [Inv48.WholeQuote.singleList] at assign
  obtain ⟨v,write⟩ := assignVar (n+1) t c captured inner hoist ret 0
    (by simp [Runtime.lookupLocal?,ceq,hoist,LocalEnv.lookup?,Frame.lookup?]) aft assign
  obtain ⟨out,ieq⟩ := assignSecond captured inner hoist 0 [(ret,value)] tail rest
    (by simp [hoist,ret,Frame.lookup?]) ceq v write
  refine ⟨out,?_⟩
  rw [pop]
  simp only [Runtime.popScope,ieq,List.drop_succ_cons,List.drop_zero]
end Inv48.ReportingGuardFrame
