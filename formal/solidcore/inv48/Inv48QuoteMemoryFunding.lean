import Inv48QuoteMemoryArgs
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32CeilFlags
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
variable {table : FunctionTable}
variable (productLinked : Inv32Internal.ProductLinked table)
variable (floorLinked : Inv32FloorCall.FloorLinked table)
variable (roundsLinked : Inv32Library.LinkAt table Inv32Bodies.RoundsUp.key
  [.word "rounding"] [.flag "_ret0"] Inv32Bodies.RoundsUp.body)
variable (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key
  [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
variable (roundedLinked : Inv32Library.LinkAt table Inv32Bodies.Ceil.key
  [.word "x",.word "y",.word "denominator",.word "rounding"] [.word "_ret0"] Inv32Bodies.Ceil.body)
include productLinked floorLinked roundsLinked uintLinked roundedLinked

def fundingCode : List Stmt := [
  .varDecl .uint256 h0 none,
  Inv32CeilHoist.code collateralArg priceArg precisionArg,
  .assign (.index (.var "quote") (.word 1))
    (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var h0)))]

/-- The generated REP block plus quote[1] store. No argument-evaluation or
computed-REP-value premise remains: the tuple and price inputs determine it. -/
theorem funding (n : Nat) (c : Context) (r : Runtime) (id a b h e s price : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word price))
    (ha : a<R) (hp : price<R) (fits : Inv48.QuoteExec.repAmount a price<R) :
    Stmt.evalList (n+20) table c r fundingCode =
      pure (.normal (put (Inv32OneArg.store r h0 (Inv48.QuoteExec.repAmount a price))
        id a (Inv48.QuoteExec.repAmount a price) h e s)) := by
  let v := Inv48.QuoteExec.repAmount a price
  let out := Inv32OneArg.store r h0 v
  have ceilStep := ceilHoist productLinked floorLinked roundsLinked uintLinked roundedLinked
    n c r collateralArg priceArg precisionArg a price ha hp fits
    (ceilInputs c r id a b h e s price ref mem P ha hp)
  have ref' : out.lookupLocal? "quote" = some (.memoryRef id) := by
    cases H : r.locals <;> simp_all [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have read : out.lookupLocal? h0 = some (.word v) := by
    cases H : r.locals <;> simp [out,Inv32OneArg.store,h0,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,H]
  have store := rep (n+19) table c out id a b h e s v ref' mem fits read
  unfold fundingCode
  exact (seqStep _ _ _ _ _ _ _ (zero (n+19) table c r h0)).trans
    ((seqStep _ _ _ _ _ _ _ ceilStep).trans
      ((seqStep _ _ _ _ _ _ _ store).trans (by rw [Stmt.evalList])))

/-- Both funding fields are actual memory writes, derived from requested
collateral and price without a collateral-selection branch premise. -/
theorem fundedQuote (n : Nat) (c : Context) (r : Runtime)
    (id oldA oldB h e s collateral price : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple oldA oldB h e s))
    (C : r.lookupLocal? "requestedInitialAttoWeth" = some (.word collateral))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word price))
    (hc : collateral<R) (hp : price<R) (fits : Inv48.QuoteExec.repAmount collateral price<R) :
    let r0 := put r id collateral oldB h e s
    Stmt.evalList (n+20) table c r
      (.assign (.index (.var "quote") (.word 0))
        (.castOp .uintCleanup 256 (.var "requestedInitialAttoWeth")) :: fundingCode) =
      pure (.normal (put (Inv32OneArg.store r0 h0 (Inv48.QuoteExec.repAmount collateral price))
        id collateral (Inv48.QuoteExec.repAmount collateral price) h e s)) := by
  have first := Inv48.QuoteMemory.collateral (n+19) table c r id oldA oldB h e s collateral ref mem hc C
  have rest := funding productLinked floorLinked roundsLinked uintLinked roundedLinked n c
    (put r id collateral oldB h e s) id collateral oldB h e s price ref
    (put_load r id collateral oldB h e s) P hc hp fits
  exact (seqStep _ _ _ _ _ _ _ first).trans rest

#print axioms fundedQuote

#print axioms funding
end Inv48.QuoteMemory
