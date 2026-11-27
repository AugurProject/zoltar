import Inv05Assign
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr Inv32Actions
namespace Inv05
def frame (cash units net added : Nat) : Frame :=
  [("cash",.word cash),("units",.word units),("net",.word net),("added",.word added)]
def work (r : Runtime) (cash units net added : Nat) := (r.withFrame (frame cash units net added)).pushScope.pushScope
def minted (r : Runtime) (cash units net added : Nat) := Inv32OneArg.store (work r cash units net added) Inv03.Bodies.tmp added
def flag := "_sol_hoist_2"
def threshold := "_sol_hoist_1"
def marked (r : Runtime) (cash units net added v : Nat) := (minted r cash units net added).declareLocal flag (.word v)
theorem precision (f : Nat) (c : Context) (r : Runtime) (cash units net a : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (ha : a<R) (pos : 0<cash) (up : 0<units)
    (fits : cash*10^9<R) (bound : a*net/units<R) :
    let ok := decide ((cash-1)*10^9 ≤ a*net/units)
    Stmt.eval (f+17) Inv03.model.core.table c (marked r cash units net a 1) precisionCheck.value =
      pure (.normal (marked r cash units net a (boolWord ok))) := by
  let t := Inv03.model.core.table
  let m := marked r cash units net a 1
  let prev := (cash-1)*10^9
  let check := a*net/units
  let ok := decide (prev≤check)
  let st := fun v => (marked r cash units net a v).pushScope.declareLocal threshold (.word prev)
  let saved := fun v => Inv32OneArg.store (st v) Inv03.Bodies.tmp check
  have hprev : prev<R := lt_of_le_of_lt (Nat.mul_le_mul_right _ (Nat.sub_le _ _)) fits
  have dec := Inv32Hoist.declEval (f+15) t c m.pushScope threshold .uint256 previous.value prev
    (earlier c _ cash hc pos fits rfl) (by rw [Ty.coerceValue?])
  have args : Inputs c (st 1) Inv03.Bodies.tmp (w "added").core (w "net").core (w "units").core a net units :=
    ⟨Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hu (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have fl := successAt t Inv03.productLinked Inv03.floorLinked (f+1) c (st 1) Inv03.Bodies.tmp
    _ _ _ a net units ha hn hu up bound args (by decide) (by decide) (by decide) (by decide)
  have wr := assignComparison (f+15) t c (saved 1) (saved (boolWord ok)) flag 1 (boolWord ok) _ _
    rfl (comparison c _ _ _ bound hprev rfl rfl)
    (by dsimp [saved,st,marked,minted,work,frame,flag,threshold,Inv32OneArg.store,Inv03.Bodies.tmp,Inv32CeilFlags.h0]; write_temps)
  apply Inv32Hoist.block _ _ _ _ (saved (boolWord ok))
  refine (seqStep _ _ _ _ _ _ _ dec).trans ?_
  refine (seqStep _ _ _ _ _ _ _ (zero (f+15) t c (st 1) Inv03.Bodies.tmp)).trans ?_
  exact (seqStep _ _ _ _ _ _ _ fl).trans ((seqStep _ _ _ _ _ _ [] wr).trans (by rw [Stmt.evalList]))
end Inv05
