import Inv48WholeQuoteEventsCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WholeQuoteEvents
set_option maxRecDepth 65536
set_option linter.unnecessarySeqFocus false
set_option maxHeartbeats 20000000

theorem evalQuiet (c : Context) (r : Runtime) (e : Source.Expr) (h : exprSafe e = true) :
    Quiet (Expr.eval c r e) := exprQuiet _ _ _ _ h

macro "quiet_expr" : tactic => `(tactic|
  repeat' first
    | (apply quietBind; · exact exprQuiet _ _ _ _ (by first | assumption | (simp only [exprSafe,Bool.and_eq_true] <;> tauto) | tauto))
    | contradiction
    | (apply_assumption; tauto)
    | rw [pureBind]
    | exact quietPure _
    | exact quietThrow _
    | exact quietExcept _
    | (apply quietBind; · assumption)
    | (apply quietBind; · exact quietExcept _)
    | (apply quietBind; · exact quietCaught _ (by assumption))
    | (apply quietBind; · exact quietCaught _ (quietExcept _))
    | (apply quietBind; · apply_assumption; tauto)
    | (rintro ⟨x,y⟩; dsimp only)
    | (intro x; try dsimp only)
    | (split <;> try dsimp only))

theorem memoryQuiet (fuel : Nat) (c : Context) (r : Runtime) (e : Source.Expr)
    (safe : exprSafe e = true) : Quiet (Expr.memoryRefOrValueFuel fuel c r e) := by
  induction fuel generalizing r e with
  | zero => exact quietThrow _
  | succ n ih =>
    cases e <;> try simp only [exprSafe,Bool.and_eq_true] at safe <;> try contradiction
    case index base idx =>
      cases base <;> try simp only [exprSafe] at safe <;> try contradiction
      cases idx <;> try simp only [exprSafe] at safe <;> try contradiction
      rw [Expr.memoryRefOrValueFuel]
      quiet_expr
    all_goals rw [Expr.memoryRefOrValueFuel]
    all_goals quiet_expr

 theorem memoryEvalQuiet (c : Context) (r : Runtime) (e : Source.Expr)
    (safe : exprSafe e = true) : Quiet (Expr.evalMemoryRefPreserving c r e) := by
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
  apply quietBind _ _ (memoryQuiet _ _ _ _ safe)
  rintro ⟨id,value,r'⟩
  repeat' first | exact quietPure _ | exact evalQuiet _ _ _ safe | split

theorem refQuiet (c : Context) (r : Runtime) (e : Source.Expr) (safe : exprSafe e = true) :
    Quiet (Expr.evalRefArg c r e) := by
  cases e <;> simp only [Expr.evalRefArg]
  all_goals repeat' first | exact evalQuiet _ _ _ safe | exact quietPure _ | split

theorem returnQuiet (c : Context) (r : Runtime) (e : Source.Expr) (safe : exprSafe e = true) :
    Quiet (Expr.evalReturnValue c r e) := by
  cases e <;> simp only [Expr.evalReturnValue]
  all_goals repeat' first | exact evalQuiet _ _ _ safe | exact quietPure _ | split

 theorem listQuiet (fuel : Nat) (c : Context) (r : Runtime) (es : List Source.Expr)
    (safe : es.all exprSafe = true) : Quiet (Expr.evalListFuel fuel c r es) ∧
      Quiet (Expr.evalRefArgListFuel fuel c r es) ∧ Quiet (Expr.evalReturnListFuel fuel c r es) := by
  induction fuel generalizing r es with
  | zero => exact ⟨quietThrow _,quietThrow _,quietThrow _⟩
  | succ n ih =>
    cases es with
    | nil => exact ⟨quietPure _,quietPure _,quietPure _⟩
    | cons e es =>
      simp only [List.all_cons,Bool.and_eq_true] at safe
      constructor
      · rw [Expr.evalListFuel]
        apply quietBind _ _ (exprQuiet _ _ _ _ safe.1)
        rintro ⟨v,r'⟩
        apply quietBind _ _ (ih r' es safe.2).1
        rintro ⟨vs,r''⟩
        exact quietPure _
      constructor
      · rw [Expr.evalRefArgListFuel]
        apply quietBind _ _ (refQuiet _ _ _ safe.1)
        rintro ⟨v,r'⟩
        apply quietBind _ _ (ih r' es safe.2).2.1
        rintro ⟨vs,r''⟩
        exact quietPure _
      · rw [Expr.evalReturnListFuel]
        apply quietBind _ _ (returnQuiet _ _ _ safe.1)
        rintro ⟨v,r'⟩
        apply quietBind _ _ (ih r' es safe.2).2.2
        rintro ⟨vs,r''⟩
        exact quietPure _
end Inv48.WholeQuoteEvents
