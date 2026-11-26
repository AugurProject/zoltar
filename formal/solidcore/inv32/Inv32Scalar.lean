import Inv32Guards
open SolidCore.Solidity.Source
namespace Inv32Scalar
abbrev Env := String → Option Nat
def Models (r : Runtime) (env : Env) := ∀ name v, env name = some v → r.lookupLocal? name = some (.word v)

structure Formula where
  core : Expr
  depth : Nat
  run : Bool → Env → Option Nat
  sound : ∀ fuel ctx rt env v, depth ≤ fuel → Models rt env → run ctx.checked env = some v →
    Expr.evalFuel fuel ctx rt core = pure (.word v, rt)

def literal (v : Nat) : Formula where
  core := .word v
  depth := 1
  run := fun _ _ => some (normWord v)
  sound fuel ctx rt env result enough _ hit := by
    cases fuel with
    | zero => contradiction
    | succ f => cases hit; rw [Expr.evalFuel]

def localWord (name : String) : Formula where
  core := .var name
  depth := 1
  run := fun _ env => env name
  sound fuel ctx rt env result enough h hit := by
    cases fuel with
    | zero => contradiction
    | succ f => exact Inv32Guards.readWord _ _ _ _ _ (h _ _ hit)

def projectWord : Except RevertData Value → Option Nat
  | .ok (.word w) => some w
  | _ => none
private theorem projectSound {x : Except RevertData Value} (h : projectWord x = some w) :
    x = .ok (.word w) := by
  cases x with
  | error => contradiction
  | ok v => cases v <;> simp_all [projectWord]

private theorem bindOk {α β : Type} (v : α) (k : α → SolI β) : (pure v >>= k) = k v := rfl

def binary (op : BinaryOp) (notAnd : op ≠ .boolAnd) (notOr : op ≠ .boolOr) (x y : Formula) : Formula where
  core := .binary op x.core y.core
  depth := max x.depth y.depth + 1
  run checked env := do
    let a ← x.run checked env
    let b ← y.run checked env
    projectWord (op.apply checked (.word a) (.word b))
  sound fuel ctx rt env v enough modeled hit := by
    cases fuel with
    | zero => omega
    | succ n =>
      cases a : x.run ctx.checked env <;> simp [a] at hit
      cases b : y.run ctx.checked env <;> simp [b] at hit
      exact Inv32Eval.binary _ _ _ _ notAnd notOr _ _ _ _ _
        (x.sound _ _ _ _ _ (by omega) modeled a) (y.sound _ _ _ _ _ (by omega) modeled b)
        (projectSound hit)

inductive Cast | uint | cleanup

def cast (kind : Cast) (size : Nat) (x : Formula) : Formula where
  core := .castOp (match kind with | .uint => .uintCast | .cleanup => .uintCleanup) size x.core
  depth := x.depth + 1
  run checked env := do
    let a ← x.run checked env
    projectWord (match kind with
      | .uint => uintCast? size (.word a)
      | .cleanup => uintCleanup? checked size (.word a))
  sound fuel ctx rt env v enough modeled hit := by
    cases fuel with
    | zero => omega
    | succ n =>
      cases a : x.run ctx.checked env <;> simp [a] at hit
      have child := x.sound n ctx rt env _ (by omega) modeled a
      have step := projectSound hit
      cases kind <;> dsimp only at step <;> rw [Expr.evalFuel, child] <;> simp only [bindOk] <;> rw [step] <;> rfl

end Inv32Scalar
