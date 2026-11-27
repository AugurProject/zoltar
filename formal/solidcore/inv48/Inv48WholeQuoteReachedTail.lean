import Inv48WholeQuoteTail
import Inv48WholeQuoteReached
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open QuoteMemory


theorem tailReached (table : FunctionTable)
    (productLinked : Inv32Internal.ProductLinked table)
    (floorLinked : Inv32FloorCall.FloorLinked table) (n : Nat) (c : Context) (r oracle : Runtime)
    (id a p bounty multiplier v minimum basePriority feeMultiplier : Nat)
    (hx hy hd fx fy fd : Expr) (oracleCode : List Stmt) (trace : EvmCompiler.Simulation.Interaction.Transcript)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a (QuoteExec.repAmount a p) 0 0 0))
    (ha : a<R) (hmul : multiplier<R) (hbase : basePriority<R) (hfee : feeMultiplier<R)
    (hc : a≤2^128-1) (hr : QuoteExec.repAmount a p≤2^128-1)
    (hh : max (a*multiplier/10000) v≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : basePriority*feeMultiplier/10000<R)
    (haltArgs : Inputs c r h0 hx hy hd a multiplier 10000)
    (oracleObs : ReachedOracleObservation (n+20) table c
      (put (Inv32OneArg.store r h0 (a*multiplier/10000))
        id a (QuoteExec.repAmount a p) (a*multiplier/10000) 0 0) oracle oracleCode trace)
    (exposureRead : oracle.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : oracle.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximumState oracle id a p (a*multiplier/10000) v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed oracle id a p (a*multiplier/10000) v minimum)
      h0 fx fy fd basePriority feeMultiplier 10000) :
    Reached (Stmt.evalList (n+20) table c r
      (floorCode 2 hx hy hd ++ oracleCode ++ [haltUpdateStmt] ++ upperGuards ++
        [.assign (.index (.var "quote") (.word 3)) exposureExpr] ++ floorCode 4 fx fy fd)) trace
      (finalState oracle id a p (a*multiplier/10000) v minimum
        (basePriority*feeMultiplier/10000)) := by
  let h := a*multiplier/10000
  let mid := put (Inv32OneArg.store r h0 h) id a (QuoteExec.repAmount a p) h 0 0
  let mx := maximumState oracle id a p h v
  have hhfit : h<R := lt_of_le_of_lt (le_trans (le_max_left h v) hh) (by decide)
  have hvfit : v<R := lt_of_le_of_lt (le_trans (le_max_right h v) hh) (by decide)
  have first := floorHalt (n+5) table productLinked floorLinked c r
    id a (QuoteExec.repAmount a p) 0 0 0 a multiplier 10000 hx hy hd ref mem
    ha hmul (by decide) (by decide) hhfit haltArgs
  have oref : oracle.lookupLocal? "quote" = some (.memoryRef id) := oracleObs.quote.trans ((store_other r _ "quote" (by decide)).trans ref)
  have omem : oracle.loadMemory? id = some (tuple a (QuoteExec.repAmount a p) h 0 0) :=
    reachedOracleMemory oracleObs (put_load _ _ _ _ _ _ _)
  have maximum := haltMaximum (n+18) table c oracle
    id a (QuoteExec.repAmount a p) h 0 0 v oref omem hhfit hvfit exposureRead
  have mxref : mx.lookupLocal? "quote" = some (.memoryRef id) := by
    dsimp [mx,maximumState]; split <;> exact oref
  have mxmem : mx.loadMemory? id = some (tuple a (QuoteExec.repAmount a p) (max h v) 0 0) := by
    dsimp [mx,maximumState]
    split
    next yes => rw [put_load,max_eq_right (Nat.le_of_lt yes)]
    next no => rw [max_eq_left (Nat.le_of_not_gt no)]; exact omem
  have mxBounty : mx.lookupLocal? "bountyAttoEth" = some (.word bounty) := by
    dsimp [mx,maximumState]; split <;> exact bountyRead
  have guards := allUpperPreserve (n+19) table c mx
    id a (QuoteExec.repAmount a p) (max h v) 0 0 bounty mxref mxmem mxBounty hc hr hh hb
  have exp := exposureComputed (n+19) table c mx
    id a (QuoteExec.repAmount a p) (max h v) 0 0 minimum mxref mxmem minimumRead
    ha hmin minle exposureFits
  have eref : (exposed oracle id a p h v minimum).lookupLocal? "quote" = some (.memoryRef id) := mxref
  have emem := put_load mx id a (QuoteExec.repAmount a p) (max h v) ((a-minimum)*100) 0
  have fee := floorSettlement (n+5) table productLinked floorLinked c
    (exposed oracle id a p h v minimum) id a (QuoteExec.repAmount a p) (max h v)
    ((a-minimum)*100) 0 basePriority feeMultiplier 10000 fx fy fd eref emem
    hbase hfee (by decide) (by decide) settlementFits feeArgs
  simp only [Nat.add_assoc] at first maximum guards exp fee
  change Stmt.evalList (n+20) _ c r (floorCode 2 hx hy hd) = pure (.normal mid) at first
  let suffix := [haltUpdateStmt] ++ upperGuards ++
    [.assign (.index (.var "quote") (.word 3)) exposureExpr] ++ floorCode 4 fx fy fd
  have finish : Stmt.evalList (n+20) table c oracle suffix =
      pure (.normal (finalState oracle id a p h v minimum (basePriority*feeMultiplier/10000))) := by
    dsimp only [suffix]
    simp only [List.append_assoc]
    rw [appendNormal _ _ _ _ mx _ _ (by
        exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] maximum).trans (by rw [Stmt.evalList]; rfl)),
      appendNormal _ _ _ _ mx _ _ guards,
      appendNormal _ _ _ _ (exposed oracle id a p h v minimum) _ _ (by
        exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] exp).trans (by rw [Stmt.evalList]; rfl))]
    exact fee
  simp only [List.append_assoc]
  rw [appendNormal _ _ _ _ mid _ _ first]
  have done : Reached (Stmt.evalList (n+20) table c oracle suffix) []
      (finalState oracle id a p h v minimum (basePriority*feeMultiplier/10000)) := by
    rw [finish]
    exact reachedPure _
  simpa only [List.append_nil,suffix,List.append_assoc] using
    reachedAppend (n+20) table c mid oracle _ oracleCode suffix trace [] oracleObs.execution done

#print axioms tailReached
end Inv48.WholeQuote
