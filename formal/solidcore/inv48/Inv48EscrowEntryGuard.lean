import Inv48EscrowEntryPrepare
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem selfGuardResult (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) :
    Stmt.eval (n+1) t c r
      (.requireStmt (.binary .eq .caller .self) (some "Only report creation")) =
      pure (if c.sender = c.self then .normal r else .reverted r (.error "Only report creation")) := by
  have ev : Expr.eval c r (.binary .eq .caller .self) =
      pure (.word (if c.sender = c.self then 1 else 0),r) := by
    unfold Expr.eval
    simp only [Expr.orderFuel]
    apply Inv32Eval.binary _ _ _ _ (by intro h; cases h) (by intro h; cases h) _ _ (.word c.sender) (.word c.self)
    · rw [Expr.evalFuel]
    · rw [Expr.evalFuel]
    · exact Inv32WideGuards.eqWord c.checked c.sender c.self senderBound selfBound
  rw [Stmt.eval]
  dsimp only
  rw [ev]
  by_cases h : c.sender = c.self <;> simp only [h,↓reduceIte] <;> rfl

/-- Successful execution of the generated self guard forces the public caller
and feed address to coincide; it also leaves the complete runtime unchanged. -/
theorem selfGuardSuccessful (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r
      (.requireStmt (.binary .eq .caller .self) (some "Only report creation"))) trace (.normal final)) :
    c.sender = c.self ∧ trace = [] ∧ final = r := by
  rw [selfGuardResult n t c r senderBound selfBound] at run
  by_cases h : c.sender = c.self
  · rw [if_pos h] at run
    have out := pureResult _ _ _ run
    exact ⟨h,out.1,Result.normal.inj out.2⟩
  · rw [if_neg h] at run
    have out := pureResult _ _ _ run
    cases out.2

#print axioms selfGuardResult
#print axioms selfGuardSuccessful
end Inv48.EscrowEntry
