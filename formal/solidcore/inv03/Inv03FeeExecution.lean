import Inv03FeeSteps

open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32QuoteExpr Inv32FloorStart Inv32FloorFastPath
namespace Inv03.Fee
def frame (q s rate net total : Nat) : Frame :=
  [("questionUnits",.word q),("supply",.word s),("minimumRate",.word rate),
   ("net",.word net),("totalUnits",.word total),("_ret0",.word 0)]
def root (r : Runtime) (q s rate net total : Nat) :=
  (r.withFrame (frame q s rate net total)).pushScope.pushScope
def cashState (r : Runtime) (q s rate net total cash : Nat) :=
  (Inv32OneArg.store (root r q s rate net total) Bodies.tmp cash).declareLocal "reservedCash" (.word cash)
def rawGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (cash raw : Nat)
    (hc : cash<R) (hv : raw<R) (C : locals r "reservedCash" = some cash)
    (V : locals r Bodies.viewName = some raw) :
    Stmt.eval (n+2) t c r (.ifElse (greater "reservedCash" Bodies.viewName).core
      (.returnValues [.word 0]) .skip) =
      pure (if raw<cash then .returned r [.word 0] else .normal r) := by
  rw [Inv32Blocks.branch _ _ _ _ _ _ _ _ (greaterRead c r _ _ _ _ hc hv C V)]
  by_cases h : raw<cash
  · simp only [h,decide_true,if_true]
    exact Inv32CompareValues.retOne _ _ _ _ _ _ (by rfl)
  · simp only [h,decide_false,Bool.false_eq_true,if_false]
    rw [Stmt.eval]

private def rawCode : List Stmt := [.varDecl .uint256 Bodies.tmp none,
  Hoist.code Bodies.rawKey Bodies.rawRet (w "questionUnits").core (w "net").core (w "totalUnits").core (Bodies.enumWord 0).value,
  temp Bodies.viewName Bodies.tmp,.ifElse (greater "reservedCash" Bodies.viewName).core (.returnValues [.word 0]) .skip]

theorem rawBodyCode : Bodies.rawCheck.value = .block rawCode := rfl

private theorem guardedBlock (n : Nat) (t : FunctionTable) (c : Context) (r last : Runtime)
    (body : List Stmt) (guard : Stmt) (low : Prop) [Decidable low] (restore : last.popScope = r)
    (setup : Stmt.evalList (n+1) t c r.pushScope body = Stmt.evalList (n+1) t c last [guard])
    (ev : Stmt.eval (n+1) t c last guard = pure (if low then .returned last [.word 0] else .normal last)) :
    Stmt.eval (n+2) t c r (.block body) = pure (if low then .returned r [.word 0] else .normal r) := by
  by_cases h : low
  · rw [if_pos h] at ev ⊢
    have done := blockReturned _ t c r last body _ (setup.trans (stop _ _ _ _ _ _ [] _ ev))
    rwa [restore] at done
  · rw [if_neg h] at ev ⊢
    have normal := Inv32Hoist.block _ t c r last body (setup.trans ((seqStep _ _ _ _ _ _ [] ev).trans (by rw [Stmt.evalList])))
    rwa [restore] at normal

private theorem checkCashAt (t : FunctionTable) (n : Nat) (c : Context) (r : Runtime) (q s rate net total cash val : Nat)
    (hq : q<R) (hn : net<R) (ht : total<R)
    (hc : cash<R) (hv : val<R)
    (call : let st := (cashState r q s rate net total cash).pushScope
            let rt := Hoist.frame st Bodies.rawRet 0 q net total 0 0
            Stmt.eval (n+25) t c rt (.internalCall [Bodies.rawRet] Bodies.rawKey
              [.var Inv32FloorHoist.a0,.var Inv32FloorHoist.a1,.var Inv32FloorHoist.a2,.var Inv32CeilHoist.a3]) =
              internalCallAssign rt [Bodies.rawRet] [.word val]) :
    let st := cashState r q s rate net total cash
    Stmt.eval (n+28) t c st Bodies.rawCheck.value =
      pure (if val<cash then .returned st [.word 0] else .normal st) := by
  let st := cashState r q s rate net total cash
  let inner := st.pushScope
  let got := Inv32OneArg.store inner Bodies.tmp val
  let last := got.declareLocal Bodies.viewName (.word val)
  have inputs : Inv32FloorHoist.Inputs c inner Bodies.tmp (w "questionUnits").core (w "net").core
      (w "totalUnits").core q net total :=
    ⟨Inv32Guards.clean _ _ _ _ _ hq (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ ht (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have step := Hoist.run (n+24) t c inner _ _ _ _ _ _ q net total 0 val inputs (enumArg c _ false) (by decide) call
  have save := Inv32Temps.temp (n+26) t c got Bodies.viewName Bodies.tmp val hv rfl
  have guard := rawGuard (n+25) t c last cash val hc hv rfl rfl
  let test := Stmt.ifElse (greater "reservedCash" Bodies.viewName).core (.returnValues [.word 0]) .skip
  have setup : Stmt.evalList (n+27) t c inner
      [.varDecl .uint256 Bodies.tmp none,
       Hoist.code Bodies.rawKey Bodies.rawRet (w "questionUnits").core (w "net").core (w "totalUnits").core (Bodies.enumWord 0).value,
       temp Bodies.viewName Bodies.tmp,test] = Stmt.evalList (n+27) t c last [test] :=
    (seqStep _ _ _ _ _ _ _ (zero (n+26) t c inner Bodies.tmp)).trans
      ((seqStep _ _ _ _ _ _ _ step).trans (seqStep _ _ _ _ _ _ _ save))
  dsimp only
  rw [rawBodyCode]
  exact guardedBlock (n+26) t c st last rawCode test (val<cash) rfl setup guard

theorem checkCash (n : Nat) (c : Context) (r : Runtime) (q s rate net total cash : Nat)
    (hq : q<R) (hn : net<R) (ht : total<R) (pos : 0<total) (scaledFits : total*10^9<R)
    (hc : cash<R) (hv : rawValue q net total<R) :
    let st := cashState r q s rate net total cash
    Stmt.eval (n+28) model.core.table c st Bodies.rawCheck.value =
      pure (if rawValue q net total<cash then .returned st [.word 0] else .normal st) := by
  apply checkCashAt model.core.table n c r q s rate net total cash (rawValue q net total) hq hn ht hc hv
  exact rawCall n c _ _ _ _ _ _ q net total hq hn ht pos scaledFits hv rfl rfl rfl rfl

def finalReturn := Stmt.ifElse (greater "questionUnits" "reservedUnits").core
  (.returnValues [Bodies.difference.value]) (.returnValues [.word 0])
def tail : List Stmt := [
  .varDecl .uint256 Bodies.tmp none,
  Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest (w "reservedCash").core
    (Bodies.scaledUnits "totalUnits").value (w "net").core (Bodies.enumWord 1).value,
  .varDecl .uint256 "reservedUnits" (some (castCopy Bodies.tmp).core),finalReturn]

theorem fundedTail (n : Nat) (c : Context) (r : Runtime) (q s rate net total cash : Nat)
    (hq : q<R) (hn : net<R) (ht : total<R) (np : 0<net) (hc : cash<R)
    (scaledFits : total*10^9<R) (funded : reserve cash total net ≤ q) :
    let start := cashState r q s rate net total cash
    let units := reserve cash total net
    let last := (Inv32OneArg.store start Bodies.tmp units).declareLocal "reservedUnits" (.word units)
    Stmt.evalList (n+28) model.core.table c start tail = pure (.returned last [.word (q-units)]) := by
  let t := model.core.table
  let start := cashState r q s rate net total cash
  let units := reserve cash total net
  let after := Inv32OneArg.store start Bodies.tmp units
  let last := after.declareLocal "reservedUnits" (.word units)
  have hu : units<R := lt_of_le_of_lt funded hq
  have args : Inv32FloorHoist.Inputs c start Bodies.tmp (w "reservedCash").core
      (Bodies.scaledUnits "totalUnits").value (w "net").core cash (total*10^9) net :=
    ⟨Inv32Guards.clean _ _ _ _ _ hc (Inv32Guards.readWord _ _ _ _ _ rfl),
     Expressions.scaled _ _ "totalUnits" total ht scaledFits rfl,
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have cl := ceilHoist (n+8) c start _ _ _ cash (total*10^9) net hc scaledFits hn np hu args
  have dec := Inv32Hoist.declEval (n+27) t c after "reservedUnits" .uint256 (castCopy Bodies.tmp).core units
    (evalFormula (castCopy Bodies.tmp) c after units (by decide) (castValue _ _ _ _ hu rfl)) (by rw [Ty.coerceValue?])
  have branch := Inv32Blocks.branch (n+27) t c last (greater "questionUnits" "reservedUnits").core
    (.returnValues [Bodies.difference.value]) (.returnValues [.word 0]) _
    (greaterRead _ _ _ _ q units hq hu rfl rfl)
  have result : Stmt.eval (n+28) t c last finalReturn = pure (.returned last [.word (q-units)]) := by
    unfold finalReturn; rw [branch]
    by_cases le : units<q
    · simp only [le,decide_true,if_true]
      have A := Inv32ProductValues.cleanup (Inv32Scalar.localWord "questionUnits") c.checked (locals last) q hq rfl
      have B := Inv32ProductValues.cleanup (Inv32Scalar.localWord "reservedUnits") c.checked (locals last) units hu rfl
      exact Inv32CompareValues.retOne _ _ _ _ _ _ (evalFormula
        (nonnegativeSub (w "questionUnits") (w "reservedUnits")) c last _ (by decide)
        (subValue _ _ _ _ _ _ hq hu funded A B))
    · simp only [le,decide_false,Bool.false_eq_true,if_false]
      rw [Nat.sub_eq_zero_of_le (Nat.le_of_not_gt le)]
      exact Inv32CompareValues.retOne _ _ _ _ _ _ (by rfl)
  exact (seqStep _ _ _ _ _ _ _ (zero (n+27) t c start Bodies.tmp)).trans
    ((seqStep _ _ _ _ _ _ _ cl).trans ((seqStep _ _ _ _ _ _ _ dec).trans (stop _ _ _ _ _ _ [] _ result)))

end Inv03.Fee
