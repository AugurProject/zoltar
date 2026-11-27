import Inv08PreviewFind
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Preview

def withEth (r : Runtime) (tm id e : Nat) := (temp r tm id id).declareLocal "ethIntegralNumerator" (.word e)
def withBoth (r : Runtime) (tm id e p : Nat) := (withEth r tm id e).declareLocal "repIntegralNumerator" (.word p)
def firstArg (r : Runtime) (tm id e p : Nat) := (withBoth r tm id e p).declareLocal a0 (.word tm)
def bothArgs (r : Runtime) (tm id e p : Nat) := (firstArg r tm id e p).declareLocal a1 (.word id)
def resultEth (r : Runtime) (tm id e p x : Nat) := (bothArgs r tm id e p).declareLocal ie (.word x)
def results (r : Runtime) (tm id e p x y : Nat) := (resultEth r tm id e p x).declareLocal ir (.word y)
macro "amount_write" : tactic => `(tactic| (dsimp only [results,resultEth,bothArgs,firstArg,withBoth,withEth]; preview_write))

theorem returnQuote (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (h : Ready r.state tm) :
    let id := q r.state tm
    let e := value r.state tm true
    let p := value r.state tm false
    let rt := results r tm id e p e p
    out.value.eval (n+1) t c rt = pure (.returned rt [.word (payout r.state tm true),.word (payout r.state tm false),.word id]) := by
  let id := q r.state tm
  let e := value r.state tm true
  let p := value r.state tm false
  let rt := results r tm id e p e p
  obtain ⟨E,P⟩ := ReleaseQuote.storedAmounts c rt e p fields (h.fits true) (h.fits false) (h.cursors true)
    (h.cursors false) (durationFits _) h.duration rfl rfl
  have I := Expiry.local48 c rt "expiredId" id h.qFit (by rfl)
  let v1 := (ReleaseQuote.pending "ethIntegralNumerator" "lastEthIntegralNumerator").value
  let v2 := (ReleaseQuote.pending "repIntegralNumerator" "lastRepIntegralNumerator").value
  let v3 := (Expiry.w48 "expiredId").value
  have E' : Expr.evalReturnValue c rt v1 = pure (.word (payout r.state tm true),rt) := E _ (Nat.le_succ _)
  have P' : Expr.evalReturnValue c rt v2 = pure (.word (payout r.state tm false),rt) := P _ (Nat.le_succ _)
  have I' : Expr.evalReturnValue c rt v3 = pure (.word id,rt) := I _ (Nat.le_succ _)
  have L : Expr.evalReturnList c rt [v1,v2,v3] = pure ([.word (payout r.state tm true),.word (payout r.state tm false),.word id],rt) := by
    change Expr.evalReturnListFuel (_+1+1+1+1) c rt [v1,v2,v3] = _
    have pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
    simp only [Expr.evalReturnListFuel,E',P',I',pb]
  change Stmt.eval _ _ _ rt (.returnValues [v1,v2,v3]) = _
  rw [Stmt.eval]; dsimp only; rw [L]; rfl

theorem remainder (n : Nat) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (h : Ready r.state tm) :
    let id := q r.state tm
    let e := value r.state tm true
    let p := value r.state tm false
    Stmt.evalList (n+60) model.core.table c (temp r tm id id)
      ((initAmounts ++ [callCaptured Integral.key [ie,ir] [a0,a1]] ++ copyAmounts ++ [out]).map (·.value)) =
      pure (.returned (results r tm id e p e p) [.word (payout r.state tm true),.word (payout r.state tm false),.word id]) := by
  let t := model.core.table
  let id := q r.state tm
  let e := value r.state tm true
  let p := value r.state tm false
  let rt := results r tm id
  let src := temp r tm id id
  have Z0 := Inv32FloorStart.zero (n+59) t c src "ethIntegralNumerator"
  have Z1 := Inv32FloorStart.zero (n+59) t c (withEth r tm id 0) "repIntegralNumerator"
  have A := Inv32Hoist.declEval (n+59) t c (withBoth r tm id 0 0) a0 .uint256 _ tm
    (Expiry.local48 _ _ "until" tm h.time rfl _ (Nat.le_succ _)) (by rfl)
  have B := Inv32Hoist.declEval (n+59) t c (firstArg r tm id 0 0) a1 .uint256 _ id
    (Expiry.local48 _ _ "expiredId" id h.qFit rfl _ (Nat.le_succ _)) (by rfl)
  have Z2 := Inv32FloorStart.zero (n+59) t c (bothArgs r tm id 0 0) ie
  have Z3 := Inv32FloorStart.zero (n+59) t c (resultEth r tm id 0 0 0) ir
  have C := Integral.call (n+55) c (rt 0 0 0 0) a0 a1 [ie,ir] tm id rfl rfl h.time h.qFit fields h.rateOrder h.fits
  have written : internalCallAssign (rt 0 0 0 0) [ie,ir] [.word e,.word p] = pure (.normal (rt 0 0 e p)) := by
    dsimp only [rt]; amount_write
  have cap := Inv32Internal.capture _ _ _ _ _ [ie,ir] _ (C.trans written)
  have E := Inv32Temps.copy (n+59) t c (rt 0 0 e p) (rt e 0 e p) "ethIntegralNumerator" ie 0 e rfl rfl
    (by dsimp only [rt]; amount_write)
  have P := Inv32Temps.copy (n+59) t c (rt e 0 e p) (rt e p e p) "repIntegralNumerator" ir 0 p rfl rfl
    (by dsimp only [rt]; amount_write)
  have R' := returnQuote (n+59) t c r tm fields h
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z0).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z1).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ B).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z2).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z3).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ E).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R')))))))))
end Inv08.Preview
