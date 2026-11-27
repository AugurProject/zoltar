import Inv08AddStreamShapes
import Inv08SearchLower
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.AddStream
theorem exprStmt (n : Nat) (c : Context) (r post : Runtime) (e : Expr) (v : Nat)
    (ev : e.eval c r=pure (.word v,post)) : Stmt.eval (n+1) model.core.table c r (.exprStmt e)=pure (.normal post) := by
  rw [Stmt.eval]; dsimp only; rw [ev]; rfl

theorem outstandingWrite (n : Nat) (c : Context) (r : Runtime) (eth : Bool) (a : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (found : r.lookupLocal? (amountLocal eth)=some (.word a))
    (fits : stored r.state (outstandingField eth)+a<R) :
    let k := outstandingField eth
    (outstanding eth).value.eval (n+1) model.core.table c r = pure (.normal
      {r with state:=r.state.storeFieldWord k.field (stored r.state k+a)}) := by
  apply exprStmt
  exact compound c r (outstandingField eth) 3 a _ _ .add fields fits (Inv32Guards.readWord _ _ _ _ _ found)
    (Inv40.addWords _ _ _ fits)

theorem cursorWrite (n : Nat) (c : Context) (r : Runtime) (eth : Bool) (a tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields)
    (found : r.lookupLocal? (FundingRecord.amountName eth)=some (.word a)) (af : a<R) (tf : tm<R)
    (time : stored r.state .through=tm) (fits : stored r.state (cursorField eth)+a*tm<R) :
    let k := cursorField eth
    (cursor eth).value.eval (n+1) model.core.table c r = pure (.normal
      {r with state:=r.state.storeFieldWord k.field (stored r.state k+a*tm)}) := by
  have prod : a*tm<R := lt_of_le_of_lt (Nat.le_add_left _ _) fits
  have v := reads c r .through fields
  rw [time] at v
  have mul := ReleaseQuote.binary (ReleaseQuote.readClean (localReads c r _ a found) af)
    (ReleaseQuote.readClean v tf) .mul (by intro h; cases h) (by intro h; cases h)
    (Inv03.Expressions.mulWord c.checked _ _ af tf prod)
  have read : Inv40.Reads c r (scale eth).value (a*tm) := Authority.double mul prod
  apply exprStmt
  exact compound c r (cursorField eth) 10 (a*tm) _ _ .add fields fits
    (read 11 (by cases eth <;> decide)) (Inv40.addWords _ _ _ fits)

theorem rateDecl (n : Nat) (c : Context) (r : Runtime) (eth : Bool) (a : Nat) (fit : a<R)
    (found : r.lookupLocal? (amountLocal eth)=some (.word a)) :
    (rate eth).value.eval (n+1) model.core.table c r = pure (.normal (r.declareLocal (FundingRecord.amountName eth) (.word a))) := by
  have v := ReleaseQuote.readClean (localReads c r _ _ found) fit
  exact Inv32Hoist.declEval n _ _ _ _ .uint256 _ a (v _ (Nat.le_succ _)) rfl

theorem endDecl (n : Nat) (c : Context) (r : Runtime) (tm d : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (atTime : stored r.state .through=tm) (duration : stored r.state .duration=d) (fit : tm+d<2^48) :
    ending.value.eval (n+1) model.core.table c r = pure (.normal (r.declareLocal "end" (.word (tm+d)))) := by
  have t := Expiry.scalarField c r .through tm fields atTime (lt_of_le_of_lt (Nat.le_add_right _ _) fit)
  have D := Expiry.scalarField c r .duration d fields duration (lt_of_le_of_lt (Nat.le_add_left _ _) fit)
  have sum := ReleaseQuote.binary t D .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords _ _ _ (lt_trans fit (by decide)))
  have V := Expiry.cleaned (Expiry.cleaned sum fit) fit
  exact Inv32Hoist.declEval n _ _ _ _ .uint256 _ (tm+d) (V _ (Nat.le_succ _)) rfl
end Inv08.AddStream
