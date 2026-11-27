import Inv48QuoteMemoryFunding
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32CeilFlags
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- The floor-call argument expressions are isolated; all call execution,
capture, hoist copying, and memory writing are derived. -/
theorem floorHalt (n : Nat) (table : FunctionTable)
    (productLinked : Inv32Internal.ProductLinked table)
    (floorLinked : Inv32FloorCall.FloorLinked table) (c : Context) (r : Runtime)
    (id a b h e s x y d : Nat) (ex ey ed : Expr)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (fits : x*y/d<R)
    (args : Inputs c r h0 ex ey ed x y d) :
    Stmt.evalList (n+15) table c r
      [.varDecl .uint256 h0 none,Inv32FloorHoist.code h0 ex ey ed,
        .assign (.index (.var "quote") (.word 2))
          (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var h0)))] =
      pure (.normal (put (Inv32OneArg.store r h0 (x*y/d)) id a b (x*y/d) e s)) := by
  let out := Inv32OneArg.store r h0 (x*y/d)
  have call := Inv32FloorHoist.successAt table productLinked floorLinked n c r h0 ex ey ed
    x y d hx hy hd pos fits args (by decide) (by decide) (by decide) (by decide)
  have ref' : out.lookupLocal? "quote" = some (.memoryRef id) := by
    cases H : r.locals <;> simp_all [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have read : out.lookupLocal? h0 = some (.word (x*y/d)) := by
    cases H : r.locals <;> simp [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have store := halt (n+14) table c out id a b h e s (x*y/d) ref' mem fits read
  exact (seqStep _ _ _ _ _ _ _ (zero (n+14) table c r h0)).trans
    ((seqStep _ _ _ _ _ _ _ call).trans
      ((seqStep _ _ _ _ _ _ _ store).trans (by rw [Stmt.evalList])))

#print axioms floorHalt

/-- The floor-call argument expressions are isolated; all call execution,
capture, hoist copying, and memory writing are derived. -/
theorem floorSettlement (n : Nat) (table : FunctionTable)
    (productLinked : Inv32Internal.ProductLinked table)
    (floorLinked : Inv32FloorCall.FloorLinked table) (c : Context) (r : Runtime)
    (id a b h e s x y d : Nat) (ex ey ed : Expr)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (fits : x*y/d<R)
    (args : Inputs c r h0 ex ey ed x y d) :
    Stmt.evalList (n+15) table c r
      [.varDecl .uint256 h0 none,Inv32FloorHoist.code h0 ex ey ed,
        .assign (.index (.var "quote") (.word 4))
          (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var h0)))] =
      pure (.normal (put (Inv32OneArg.store r h0 (x*y/d)) id a b h e (x*y/d))) := by
  let out := Inv32OneArg.store r h0 (x*y/d)
  have call := Inv32FloorHoist.successAt table productLinked floorLinked n c r h0 ex ey ed
    x y d hx hy hd pos fits args (by decide) (by decide) (by decide) (by decide)
  have ref' : out.lookupLocal? "quote" = some (.memoryRef id) := by
    cases H : r.locals <;> simp_all [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have read : out.lookupLocal? h0 = some (.word (x*y/d)) := by
    cases H : r.locals <;> simp [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have store := settlement (n+14) table c out id a b h e s (x*y/d) ref' mem fits read
  exact (seqStep _ _ _ _ _ _ _ (zero (n+14) table c r h0)).trans
    ((seqStep _ _ _ _ _ _ _ call).trans
      ((seqStep _ _ _ _ _ _ _ store).trans (by rw [Stmt.evalList])))

#print axioms floorSettlement
end Inv48.QuoteMemory
