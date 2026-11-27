import Inv48EscrowJoinLocal
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def pullStatements : List Stmt :=
  [.varDecl .address "_ic_arg_0" (some (.immutable "collateralToken")),
   .varDecl .address "_ic_arg_1" (some (.var "payer")),
   .varDecl .address "_ic_arg_2" (some (.var "escrow")),
   .varDecl .uint256 "_ic_arg_3" (some (.castOp .uintCleanup 256 (.var "wethAmount"))),
   pullCall]
def pullBlock : Stmt := .block pullStatements

/-- Complete argument preparation, arbitrary captured callee, and scope exit
    preserve every pre-block local, without any argument-local assumptions. -/
theorem pullBlockNormal (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+3) t c r pullBlock) trace (.normal final)) :
    final.locals = r.locals := by
  obtain ⟨inner,body,popped⟩ := blockNormal (n+2) t c r final pullStatements trace run
  unfold pullStatements at body
  obtain ⟨r0,t0,u0,_,d0,s0⟩ := sequenceNormal _ _ _ _ _ _ _ _ body
  obtain ⟨v0,_,eq0⟩ := declarationNormal (n+1) t c r.pushScope r0 .address "_ic_arg_0"
    (.immutable "collateralToken") (immutableFrozen c r.pushScope _) t0 d0
  subst r0
  obtain ⟨r1,t1,u1,_,d1,s1⟩ := sequenceNormal _ _ _ _ _ _ _ _ s0
  obtain ⟨v1,_,eq1⟩ := declarationNormal (n+1) t c _ r1 .address "_ic_arg_1"
    (.var "payer") (varFrozen c _ _) t1 d1
  subst r1
  obtain ⟨r2,t2,u2,_,d2,s2⟩ := sequenceNormal _ _ _ _ _ _ _ _ s1
  obtain ⟨v2,_,eq2⟩ := declarationNormal (n+1) t c _ r2 .address "_ic_arg_2"
    (.var "escrow") (varFrozen c _ _) t2 d2
  subst r2
  obtain ⟨r3,t3,u3,_,d3,s3⟩ := sequenceNormal _ _ _ _ _ _ _ _ s2
  obtain ⟨v3,_,eq3⟩ := declarationNormal (n+1) t c _ r3 .uint256 "_ic_arg_3"
    (.castOp .uintCleanup 256 (.var "wethAmount")) (cleanupVarFrozen c _ _ _) t3 d3
  subst r3
  obtain ⟨called,tc,uc,_,call,empty⟩ := sequenceNormal _ _ _ _ _ _ _ _ s3
  rw [Stmt.evalList] at empty
  have last := pureResult _ _ _ empty
  cases last.2
  have saved := capturedVarsNormal n t c _ inner pullKey
    ["_ic_arg_0","_ic_arg_1","_ic_arg_2","_ic_arg_3"] tc call
  rw [popped]
  simp only [Runtime.popScope,saved,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,
    List.drop_succ_cons,List.drop_zero]

#print axioms pullBlockNormal
end Inv48.EscrowJoin
