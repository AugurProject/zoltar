import Inv48SymbolicCloneCore
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def loopState (base : Runtime) (code : List Nat) (i acc : Nat) : Runtime :=
  { base with locals := [("#extword", .word acc), ("#extindex", .word i),
      ("#extcode", .bytes code), ("offset", .word 45)] :: base.locals }

@[simp] theorem loop_lookup (base : Runtime) (code : List Nat) (i acc : Nat) (name : String) :
    (loopState base code i acc).lookupLocal? name =
      if name = "#extword" then some (.word acc) else
      if name = "#extindex" then some (.word i) else
      if name = "#extcode" then some (.bytes code) else
      if name = "offset" then some (.word 45) else base.lookupLocal? name := by
  by_cases a : name = "#extword" <;> by_cases b : name = "#extindex" <;>
    by_cases d : name = "#extcode" <;> by_cases e : name = "offset" <;>
    simp_all [loopState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?, eq_comm]

-- The state parameter remains arbitrary: only the explicit local frame is installed.
theorem read_bytes (fuel : Nat) (c : Context) (r : Runtime) (name : String) (bs : List Nat)
    (h : r.lookupLocal? name = some (.bytes bs)) :
    Expr.evalFuel (fuel+1) c r (.var name) = pure (.bytes bs, r) := by
  have noStorage : r.lookupStorageBase? name = none := by simp [Runtime.lookupStorageBase?, h]
  rw [Expr.evalFuel, noStorage, h]
  rfl
theorem cast_read (fuel : Nat) (c : Context) (r : Runtime) (e : Expr)
    (a b : Value) (kind : CastKind) (width : Nat)
    (h : Expr.evalFuel fuel c r e = pure (a,r))
    (converted : (match kind with
      | .uintCast => uintCast? width a
      | .uintCleanup => uintCleanup? c.checked width a
      | _ => .error .typeMismatch) = .ok b)
    (supported : kind = .uintCast ∨ kind = .uintCleanup) :
    Expr.evalFuel (fuel+1) c r (.castOp kind width e) = pure (b,r) := by
  rcases supported with hkind | hkind <;> subst kind <;>
    dsimp only at converted <;> rw [Expr.evalFuel,h] <;> simp only [pb] <;> rw [converted] <;> rfl

theorem ternary_read (fuel : Nat) (c : Context) (r : Runtime) (p yes no : Expr)
    (v : Value) (hp : Expr.evalFuel fuel c r p = pure (.word 1,r))
    (hy : Expr.evalFuel fuel c r yes = pure (v,r)) :
    Expr.evalFuel (fuel+1) c r (.ternary p yes no) = pure (v,r) := by
  rw [Expr.evalFuel,hp]; exact hy

theorem and_true (fuel : Nat) (c : Context) (r : Runtime) (a b : Expr)
    (ha : Expr.evalFuel fuel c r a = pure (.word 1,r))
    (hb : Expr.evalFuel fuel c r b = pure (.word 1,r)) :
    Expr.evalFuel (fuel+1) c r (.binary .boolAnd a b) = pure (.word 1,r) := by
  rw [Expr.evalFuel,ha]; dsimp only [pb]
  change (do let (v,r') ← Expr.evalFuel fuel c r b
             let w ← v.expectWord
             pure (Value.word (boolWord (wordTruthy w)),r')) = _
  rw [hb]; rfl

end Inv48.SymbolicClone
