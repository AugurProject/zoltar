import Inv48ReportingGuardFrameExternal
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem guardFrameLarge (n : Nat) (t : FunctionTable) (c : Context) :
    StatementFrame (n+4) t c guardP.value := by
  intro r final trace run
  obtain ⟨inner,body,pop⟩ := blockNormal (n+3) t c r final bodyP.value trace run
  obtain ⟨r1,b1,a1,_,d1,body⟩ := sequenceNormal (n+3) t c r.pushScope inner _ _ trace body
  have e1 := defaultNormal (n+2) t c r.pushScope r1 .uint256 hoist b1 d1
  have s1 : r1.locals = [[(hoist,.word 0)]] ++ r.locals := by
    rw [e1]; simp [Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Ty.defaultValue]
  obtain ⟨r2,b2,a2,_,u,body⟩ := sequenceNormal (n+3) t c r1 inner _ _ a1 body
  obtain ⟨uv,s2⟩ := universeBlock n t c r1 r2 [] r.locals s1 b2 u
  obtain ⟨r3,b3,a3,_,d3,body⟩ := sequenceNormal (n+3) t c r2 inner _ _ a2 body
  obtain ⟨v3,_,e3⟩ := declarationNormal (n+2) t c r2 r3 .uint256 "#view47899"
    (.castOp .uintCleanup 248 (.var hoist)) (cleanupVarFrozen c r2 hoist 248) b3 d3
  have s3 : r3.locals = [("#view47899",v3),(hoist,uv)]::r.locals := by
    rw [e3]; simp only [Runtime.declareLocal,s2,LocalEnv.declare]
  obtain ⟨r4,b4,a4,_,d4,body⟩ := sequenceNormal (n+3) t c r3 inner _ _ a3 body
  have e4 := defaultNormal (n+2) t c r3 r4 .bool hoist b4 d4
  have s4 : r4.locals = [(hoist,.word 0),("#view47899",v3),(hoist,uv)]::r.locals := by
    rw [e4]; simp only [Runtime.declareLocal,s3,LocalEnv.declare,Ty.defaultValue]
  obtain ⟨r5,b5,a5,_,external,body⟩ := sequenceNormal (n+3) t c r4 inner _ _ a4 body
  obtain ⟨rv,s5⟩ := reportingCall (n+1) t c r4 r5 [("#view47899",v3),(hoist,uv)]
    r.locals s4 b5 external
  obtain ⟨r6,b6,a6,_,d6,last⟩ := sequenceNormal (n+3) t c r5 inner _ _ a5 body
  obtain ⟨v6,_,e6⟩ := declarationNormal (n+2) t c r5 r6 .bool "#view47900"
    (.var hoist) (varFrozen c r5 hoist) b6 d6
  have s6 : r6.locals = [("#view47900",v6),(hoist,rv),("#view47899",v3),(hoist,uv)]::r.locals := by
    rw [e6]; simp only [Runtime.declareLocal,s5,LocalEnv.declare]
  change ExecutesOK (Stmt.evalList (n+3) t c r6
    [.requireStmt (.var "#view47900") (some "Security pool reporting window closed")])
    a6 (.normal inner) at last
  rw [Inv48.WholeQuote.singleList] at last
  have req := requireFrame (n+2) t c (.var "#view47900")
    (some "Security pool reporting window closed") (.var _)
  have si := req r6 inner a6 last
  rw [pop]
  simp only [Runtime.popScope,si,s6,List.drop_succ_cons,List.drop_zero]

/-- Discharges guard 0 for every statement fuel and every successful generated
execution. No clone-code, oracle-answer, prepared-frame, or lookup premises. -/
theorem oracleFrame (fuel : Nat) (t : FunctionTable) (c : Context) :
    StatementFrame fuel t c (Inv48.GuardArgsFrame.guard 0) := by
  rw [actualGuard]
  cases fuel with
  | zero => intro r final trace run; rw [Stmt.eval] at run; cases run
  | succ fuel =>
    cases fuel with
    | zero =>
      intro r final trace run
      obtain ⟨inner,body,_⟩ := blockNormal 0 t c r final bodyP.value trace run
      obtain ⟨mid,bt,aft,_,first,_⟩ := sequenceNormal 0 t c r.pushScope inner _ _ trace body
      rw [Stmt.eval] at first
      cases first
    | succ fuel =>
      cases fuel with
      | zero =>
        intro r final trace run
        obtain ⟨inner,body,_⟩ := blockNormal 1 t c r final bodyP.value trace run
        obtain ⟨mid,bt,aft,_,_,body⟩ := sequenceNormal 1 t c r.pushScope inner _ _ trace body
        obtain ⟨mid2,bt2,aft2,_,ucall,_⟩ := sequenceNormal 1 t c mid inner _ _ aft body
        obtain ⟨inside,body,_⟩ := blockNormal 0 t c mid mid2 _ bt2 ucall
        obtain ⟨mid3,bt3,aft3,_,first,_⟩ := sequenceNormal 0 t c mid.pushScope inside _ _ bt2 body
        rw [Stmt.eval] at first
        cases first
      | succ fuel =>
        cases fuel with
        | zero =>
          intro r final trace run
          obtain ⟨inner,body,_⟩ := blockNormal 2 t c r final bodyP.value trace run
          obtain ⟨mid,bt,aft,_,_,body⟩ := sequenceNormal 2 t c r.pushScope inner _ _ trace body
          obtain ⟨mid2,bt2,aft2,_,ucall,_⟩ := sequenceNormal 2 t c mid inner _ _ aft body
          obtain ⟨inside,body,_⟩ := blockNormal 1 t c mid mid2 _ bt2 ucall
          obtain ⟨mid3,bt3,aft3,_,_,body⟩ := sequenceNormal 1 t c mid.pushScope inside _ _ bt2 body
          obtain ⟨mid4,bt4,aft4,_,call,_⟩ := sequenceNormal 1 t c mid3 inside _ _ aft3 body
          rw [Stmt.eval] at call
          dsimp only at call
          rw [Stmt.eval] at call
          cases call
        | succ n => exact guardFrameLarge n t c

/-- Exact lookup equality, including absent or non-word incoming bindings. -/
theorem exactLookups (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval fuel t c r (Inv48.GuardArgsFrame.guard 0)) trace (.normal final)) :
    final.lookupLocal? "proposedRepPerEthPrice" = r.lookupLocal? "proposedRepPerEthPrice" ∧
    final.lookupLocal? "requestedInitialAttoWeth" = r.lookupLocal? "requestedInitialAttoWeth" ∧
    final.lookupLocal? "bountyAttoEth" = r.lookupLocal? "bountyAttoEth" := by
  have same := oracleFrame fuel t c r final trace run
  simp only [Runtime.lookupLocal?,same,and_self]

theorem lookups (fuel : Nat) (c : Context) (r final : Runtime) (p a b : Nat)
    (initial : Lookups r p a b) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval fuel Inv48.Source.model.core.table c r
      (Inv48.GuardArgsFrame.guard 0)) trace (.normal final)) : Lookups final p a b := by
  have same := oracleFrame fuel Inv48.Source.model.core.table c r final trace run
  simpa only [Lookups,Runtime.lookupLocal?,same] using initial
end Inv48.ReportingGuardFrame
