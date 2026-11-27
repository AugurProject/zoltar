import Inv48BountyGuardFrameGuard
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem helperFrame (fuel : Nat) (t : FunctionTable) (c : Context) :
    StatementFrame fuel t c (guard 3) := by
  intro r final trace run
  rw [actual] at run
  cases fuel with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    obtain ⟨inside,exec,eq⟩ := blockNormal n t c r final body trace run
    cases n with
    | zero =>
      obtain ⟨a,t1,t2,_,first,rest⟩ := sequenceNormal 0 t c _ inside _ _ trace exec
      rw [Stmt.eval] at first
      cases first
    | succ n =>
      obtain ⟨a,t1,t2,_,decl,rest⟩ := sequenceNormal (n+1) t c _ inside _ _ trace exec
      rw [noneDecl] at decl
      have da := (pureResult _ _ _ decl).2
      cases da
      obtain ⟨b,t3,t4,_,nested,rest⟩ := sequenceNormal (n+1) t c _ inside _ _ t2 rest
      obtain ⟨w,bs⟩ := innerFrame n t c _ b r.locals
        (by simp [Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]) t3 nested
      obtain ⟨d,t5,t6,_,view,rest⟩ := sequenceNormal (n+1) t c b inside _ _ t4 rest
      obtain ⟨v,_,ds⟩ := declarationNormal n t c b d .uint256 "#view47925" viewExpr
        (cleanupVarFrozen c b hoist 256) t5 view
      obtain ⟨e,t7,t8,_,required,done⟩ := sequenceNormal (n+1) t c d inside _ _ t6 rest
      have safe : ReadOnly condition := .binary .ge (by intro h; cases h) (by intro h; cases h)
        (.cleanup 256 (.var _)) (.cleanup 256 (.var _))
      have es := requireFrame n t c condition (some "Oracle bounty too small") safe d e t7 required
      rw [Stmt.evalList] at done
      have endEq := (pureResult _ _ _ done).2
      cases endEq
      simp [eq,Runtime.popScope,es,ds,Runtime.declareLocal,LocalEnv.declare,bs]

theorem restoresLookups (fuel : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (p a b : Nat) (before : Lookups r p a b)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval fuel t c r (guard 3)) trace (.normal final)) :
    final.locals = r.locals ∧ Lookups final p a b := by
  have same := helperFrame fuel t c r final trace run
  exact ⟨same,by simpa only [Lookups,Runtime.lookupLocal?,same] using before⟩
/-- Original words are supplied by the shared-call request frame, rather than
by lookup premises at a downstream quote site. -/
theorem originalArgs (fuel : Nat) (c : Context) (raw final : Runtime)
    (s p a b g : Nat) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval fuel Inv48.Source.model.core.table c
      (entry raw s p a b g).pushScope.pushScope (guard 3)) trace (.normal final)) :
    final.locals = ((entry raw s p a b g).pushScope.pushScope).locals ∧ Lookups final p a b := by
  apply restoresLookups fuel _ c _ final p a b _ trace run
  simp [Lookups,entry,Runtime.pushScope,Runtime.lookupLocal?,
    Inv48.RequestPrologue.requestFrame,LocalEnv.lookup?,Frame.lookup?]
end Inv48.BountyGuardFrame
