import Inv48MinimumFullTraceStatements
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def stmtSafe : Nat → FunctionTable → Source.Stmt → Bool
  | 0,_,_ => false
  | k+1,t,.block ss => ss.all (stmtSafe k t)
  | k+1,t,.captureReturn _ s | k+1,t,.checked s | k+1,t,.unchecked s => stmtSafe k t s
  | k+1,t,.internalCall _ key args => args.all exprSafe && (t.lookup? key).any (fun fn => stmtSafe k t fn.body)
  | k+1,t,.ifElse e a b => exprSafe e && stmtSafe k t a && stmtSafe k t b
  | _+1,_,.assign (.var _) e | _+1,_,.exprStmt e | _+1,_,.requireStmt e _ => exprSafe e
  | _+1,_,.varDecl _ _ init => init.all exprSafe
  | _+1,_,.returnValues es | _+1,_,.revert _ es => es.all exprSafe
  | _+1,_,.skip | _+1,_,.revertError _ => true
  | _+1,_,_ => false

theorem listFromQuiet (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ss : List Source.Stmt) (h : ∀ s ∈ ss, ∀ rt, Quiet (Stmt.eval fuel t c rt s)) :
    Quiet (Stmt.evalList fuel t c r ss) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; exact quietPure _
  | cons s ss ih =>
    rw [Stmt.evalList]
    apply quietBind _ _ (h s (by simp) r)
    intro v
    cases v <;> try exact quietPure _
    apply ih
    intro s mem rt
    exact h s (by simp [mem]) rt

theorem stmtQuiet (depth : Nat) (t : FunctionTable) (s : Source.Stmt)
    (safe : stmtSafe depth t s = true) :
    ∀ fuel c r, Quiet (Stmt.eval fuel t c r s) := by
  induction depth generalizing s with
  | zero => cases safe
  | succ k ih =>
    intro fuel c r
    cases fuel with
    | zero => rw [Stmt.eval]; exact quietThrow _
    | succ n =>
      cases s <;> try simp only [stmtSafe,Bool.and_eq_true] at safe <;> try contradiction
      case assign target e =>
        cases target <;> simp only [stmtSafe] at safe <;> try contradiction
        exact assignQuiet _ _ _ _ _ _ safe
      case block ss =>
        rw [Stmt.eval]
        apply quietBind _ _ (listFromQuiet _ _ _ _ ss (fun st mem rt => ih st (List.all_eq_true.mp safe st mem) n c rt))
        intro v
        exact quietPure _
      case internalCall targets key args =>
        cases found : t.lookup? key with
        | none => simp [found] at safe
        | some fn =>
          simp only [found,Option.any_some] at safe
          have argQuiet := (listQuiet (Expr.listEvalFuel args) c r args safe.1).2.1
          have bodyQuiet := ih fn.body safe.2
          rw [Stmt.eval]
          apply quietBind _ _ (quietCaught _ argQuiet)
          intro argsResult
          cases argsResult with
          | error e => exact quietPure _
          | ok pair =>
            rcases pair with ⟨vs,rt⟩
            simp only [found]
            split
            · exact quietPure _
            · apply quietBind _ _ (bodyQuiet _ _ _)
              intro v
              exact finishQuiet _ _ _ _
      case checked body =>
        rw [Stmt.eval]
        exact ih body safe n _ r
      case unchecked body =>
        rw [Stmt.eval]
        exact ih body safe n _ r
      case captureReturn names body =>
        rw [Stmt.eval]
        apply quietBind _ _ (ih body safe n c r)
        intro v
        quiet_stmt
      case ifElse e a b =>
        rw [Stmt.eval]
        apply quietBind _ _ (quietCaught _ (evalQuiet _ _ _ safe.1.1))
        intro v
        cases v with
        | error err => exact quietPure _
        | ok pair =>
          rcases pair with ⟨value,rt⟩
          dsimp only
          cases h : value.expectWord with
          | error err => simp only; exact quietPure _
          | ok word =>
            simp only
            split
            · exact ih a safe.1.2 n c rt
            · exact ih b safe.2 n c rt
      case varDecl ty name init =>
        cases init with
        | none => rw [Stmt.eval]; exact quietPure _
        | some e =>
          have he : exprSafe e = true := safe
          rw [Stmt.eval]
          apply quietBind _ _ (quietCaught _ (evalQuiet _ _ _ he))
          intro v
          quiet_stmt
      case returnValues es =>
        rw [Stmt.eval]
        apply quietBind _ _ (quietCaught _ (listQuiet _ c r es safe).2.2)
        intro v
        cases v <;> exact quietPure _
      case revert name es =>
        rw [Stmt.eval]
        apply quietBind _ _ (quietCaught _ (listQuiet _ c r es safe).1)
        intro v
        quiet_stmt
      all_goals rw [Stmt.eval]
      all_goals quiet_stmt
end Inv48.MinimumFullTrace
