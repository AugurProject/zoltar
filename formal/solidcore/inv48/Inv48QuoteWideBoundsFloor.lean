import Inv48QuoteWideBoundsLinks
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.QuoteWideBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
/-- The two limbs are quotient and remainder by the word radix, not by the divisor. -/
theorem limbs (x y d : Nat) (hx : x<R) (hy : y<R) (pos : 0<d) :
    x*y/R<R ∧ x*y%R<R ∧
    x*y = x*y/R*R+x*y%R ∧ (x*y/d<R ↔ x*y/R<d) := by
  have rp : 0<R := by decide
  have product : x*y<R*R := Nat.mul_lt_mul_of_lt_of_lt hx hy
  refine ⟨(Nat.div_lt_iff_lt_mul rp).mpr product,Nat.mod_lt _ rp,?_,?_⟩
  · simpa only [Nat.mul_comm R] using (Nat.div_add_mod (x*y) R).symm
  · rw [Nat.div_lt_iff_lt_mul pos,Nat.div_lt_iff_lt_mul rp]
    rw [Nat.mul_comm R d]
/-- Invert the actual generated floor call on the supplied successful trace.
No quotient-fit hypothesis is used. -/
theorem floorFits (n : Nat) (c : Context) (r : Runtime) (x y d : String)
    (targets : List String) (a b den : Nat)
    (ha : a<R) (hb : b<R) (hd : den<R) (pos : 0<den)
    (X : r.lookupLocal? x = some (.word a)) (Y : r.lookupLocal? y = some (.word b))
    (D : r.lookupLocal? d = some (.word den))
    (trace : Interaction.Transcript) (result : Result)
    (run : Interaction.Executes
      (Stmt.eval (n+23) Inv48.Source.model.core.table c r
        (.internalCall targets Inv32Bodies.Floor.key [.var x,.var y,.var d])) trace (.ok result))
    (normal : ∀ mid err, result ≠ .reverted mid err) : a*b/den<R := by
  by_contra bad
  obtain ⟨next,err,ev⟩ := Inv32FloorOverflow.callAt _ rejectionLinks n c r x y d targets
    a b den ha hb hd pos (Nat.le_of_not_gt bad) X Y D
  rw [ev] at run
  cases run
  exact normal next err rfl
#print axioms limbs
#print axioms floorFits
end Inv48.QuoteWideBounds
