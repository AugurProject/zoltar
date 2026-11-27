import Inv48FundingMathTailOracle
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.FundingMathTail
open Inv48.QuoteMemory Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000

def maximum (r : Runtime) (id a b h e s v : Nat) :=
  if h<v then put r id a b v e s else r

def exposed (r : Runtime) (id a b h e s v minimum : Nat) :=
  put (maximum r id a b h e s v) id a b (max h v) ((a-minimum)*100) s

def finalState (r : Runtime) (id a b h e s v minimum fee : Nat) :=
  put (Inv32OneArg.store (exposed r id a b h e s v minimum) h0 fee)
    id a b (max h v) ((a-minimum)*100) fee

def finishCode (fx fy fd : Expr) : List Stmt :=
  [haltUpdateStmt] ++ upperGuards ++
    [.assign (.index (.var "quote") (.word 3)) exposureExpr] ++ floorCode 4 fx fy fd

theorem finish (n : Nat) (c : Context) (r : Runtime)
    (id a b h e s v minimum bounty base feeMul : Nat) (fx fy fd : Expr)
    (before : Inv48.QuoteTailPreserve.Keeps r id a b)
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (ha : a<R) (hh : max h v≤2^128-1) (hbase : base<R) (hfee : feeMul<R)
    (hc : a≤2^128-1) (hr : b≤2^128-1) (hb : bounty≤2^96-1)
    (hmin : minimum<R) (minle : minimum≤a) (exposureFits : (a-minimum)*100<R)
    (settlementFits : base*feeMul/10000<R)
    (exposureRead : r.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (bountyRead : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (minimumRead : (maximum r id a b h e s v).loadImmutableField c
      "minimumReportCollateral" = .ok (.word minimum))
    (feeArgs : Inputs c (exposed r id a b h e s v minimum)
      h0 fx fy fd base feeMul 10000) :
    Stmt.evalList (n+52) table c r (finishCode fx fy fd) =
      pure (.normal (finalState r id a b h e s v minimum (base*feeMul/10000))) ∧
    Inv48.QuoteTailPreserve.Keeps
      (finalState r id a b h e s v minimum (base*feeMul/10000)) id a b := by
  let mx := maximum r id a b h e s v
  have hfit : h<R := lt_of_le_of_lt (le_trans (le_max_left h v) hh) (by decide)
  have vfit : v<R := lt_of_le_of_lt (le_trans (le_max_right h v) hh) (by decide)
  have maximumRun := haltMaximum (n+50) table c r id a b h e s v before.1 mem hfit vfit exposureRead
  have mxref : mx.lookupLocal? "quote" = some (.memoryRef id) := by
    dsimp [mx,maximum]; split <;> exact before.1
  have mxmem : mx.loadMemory? id = some (tuple a b (max h v) e s) := by
    dsimp [mx,maximum]
    split
    next yes => rw [put_load,max_eq_right (Nat.le_of_lt yes)]
    next no => rw [max_eq_left (Nat.le_of_not_gt no)]; exact mem
  have mxBounty : mx.lookupLocal? "bountyAttoEth" = some (.word bounty) := by
    dsimp [mx,maximum]; split <;> exact bountyRead
  have guards := allUpperPreserve (n+51) table c mx id a b (max h v) e s bounty
    mxref mxmem mxBounty hc hr hh hb
  have exp := exposureComputed (n+51) table c mx id a b (max h v) e s minimum
    mxref mxmem minimumRead ha hmin minle exposureFits
  have eref : (exposed r id a b h e s v minimum).lookupLocal? "quote" = some (.memoryRef id) := mxref
  have emem := put_load mx id a b (max h v) ((a-minimum)*100) s
  have fee := floorSettlement (n+37) table productLink floorLink c
    (exposed r id a b h e s v minimum) id a b (max h v) ((a-minimum)*100) s
    base feeMul 10000 fx fy fd eref emem hbase hfee (by decide) (by decide) settlementFits feeArgs
  simp only [Nat.add_assoc] at maximumRun guards exp fee
  refine ⟨?_,?_,max h v,(a-minimum)*100,base*feeMul/10000,put_load _ _ _ _ _ _ _⟩
  · dsimp only [finishCode]
    simp only [List.append_assoc]
    rw [appendNormal _ _ _ _ mx _ _ (by
        exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] maximumRun).trans (by rw [Stmt.evalList]; rfl)),
      appendNormal _ _ _ _ mx _ _ guards,
      appendNormal _ _ _ _ (exposed r id a b h e s v minimum) _ _ (by
        exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] exp).trans (by rw [Stmt.evalList]; rfl))]
    exact fee
  · exact (store_other (exposed r id a b h e s v minimum) _ "quote" (by decide)).trans eref
end Inv48.FundingMathTail
