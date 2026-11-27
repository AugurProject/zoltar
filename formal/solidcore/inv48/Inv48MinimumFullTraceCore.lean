import Inv48QuoteMinimumEventsRestricted
import Inv48MinimumSuffixPathRounded
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Quiet (tree : SolI α) : Prop := ∃ result, tree = .done result

theorem quietPure (x : α) : Quiet (pure x) := ⟨.ok x,rfl⟩
theorem quietThrow (e : SolidityFailure) : Quiet (throw e : SolI α) := ⟨.error e,rfl⟩
theorem quietExcept (x : Except RevertData α) : Quiet (liftM x : SolI α) := by
  cases x <;> exact ⟨_,rfl⟩
theorem quietBind (a : SolI α) (k : α → SolI β) (ha : Quiet a)
    (hk : ∀ x, Quiet (k x)) : Quiet (a >>= k) := by
  obtain ⟨v,rfl⟩ := ha
  cases v with
  | ok x => exact hk x
  | error e => exact ⟨_,rfl⟩
theorem quietCaught (a : SolI α) (h : Quiet a) : Quiet a.caught := by
  obtain ⟨v,rfl⟩ := h
  cases v with
  | ok x => exact ⟨_,rfl⟩
  | error e => cases e <;> exact ⟨_,rfl⟩
theorem quietEvents (a : SolI α) (h : Quiet a)
    (run : Interaction.Executes a tr result) : tr = [] := by
  obtain ⟨v,rfl⟩ := h
  cases run
  rfl

theorem pureBind (x : α) (k : α → SolI β) : (pure x >>= k) = k x := rfl

macro "quiet_leaf" : tactic => `(tactic|
  repeat' first
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

def exprSafe : Source.Expr → Bool
  | .word _ | .var _ | .immutable _ => true
  | .binary _ a b => exprSafe a && exprSafe b
  | .unary _ a | .castOp _ _ a | .enumFromUInt _ a => exprSafe a
  | .assignment _ _ (.var _) a => exprSafe a
  | .ternary a b c => exprSafe a && exprSafe b && exprSafe c
  | .mulMod a b c | .addMod a b c => exprSafe a && exprSafe b && exprSafe c
  | _ => false

theorem resolveVarQuiet (fuel : Nat) (c : Context) (r : Runtime) (name : String) :
    Quiet (Expr.resolveLValueFuel fuel c r (.var name)) := by
  cases fuel <;> rw [Expr.resolveLValueFuel] <;> quiet_leaf

theorem exprQuiet (fuel : Nat) (c : Context) (r : Runtime) (e : Source.Expr)
    (safe : exprSafe e = true) : Quiet (Expr.evalFuel fuel c r e) := by
  induction fuel generalizing r e with
  | zero => exact quietThrow _
  | succ n ih =>
    cases e <;> try simp only [exprSafe, Bool.and_eq_true] at safe <;> try contradiction
    case binary op a b => cases op <;> rw [Expr.evalFuel] <;> quiet_leaf
    case assignment op cleanup target rhs =>
      cases target <;> simp only [exprSafe] at safe <;> try contradiction
      rw [Expr.evalFuel]
      apply quietBind _ _ (ih _ _ safe)
      rintro ⟨v,r'⟩
      apply quietBind _ _ (resolveVarQuiet _ _ _ _)
      rintro ⟨resolved,r''⟩
      quiet_leaf
    all_goals rw [Expr.evalFuel]
    all_goals try quiet_leaf
