import Inv03FeeExecution
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32QuoteExpr Inv32FloorStart Inv32FloorFastPath
namespace Inv03.Fee

def guardStmt : Stmt := .ifElse (Bodies.zeros "net" "totalUnits").value (.returnValues [.word 0]) .skip
def instructions : List Stmt := guardStmt :: .varDecl .uint256 Bodies.tmp none ::
  Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest (w "supply").core (w "minimumRate").core (.word (10^18)) (Bodies.enumWord 1).value ::
  .varDecl .uint256 "reservedCash" (some (castCopy Bodies.tmp).core) :: Bodies.rawCheck.value :: tail
theorem bodyCode : Bodies.feeBody.value = .block [cleanParam "questionUnits",cleanParam "supply",
    cleanParam "minimumRate",cleanParam "net",cleanParam "totalUnits",.skip,.block instructions] := rfl

theorem execute (n : Nat) (c : Context) (r : Runtime) (q s rate net total : Nat)
    (hq : q<R) (hs : s<R) (hr : rate<R) (hn : net<R) (ht : total<R)
    (np : 0<net) (tp : 0<total) (hc : ceilQuot (s*rate) (10^18)<R)
    (scaledFits : total*10^9<R) (hv : rawValue q net total<R) :
    let src := r.withFrame (frame q s rate net total)
    Stmt.eval (n+30) model.core.table c src Bodies.feeBody.value =
      pure (.returned src [.word (budget q (ceilQuot (s*rate) (10^18)) net total)]) := by
  let t := model.core.table
  let cash := ceilQuot (s*rate) (10^18)
  let src := r.withFrame (frame q s rate net total)
  let outer := src.pushScope
  let inner := root r q s rate net total
  let got := Inv32OneArg.store inner Bodies.tmp cash
  let saved := cashState r q s rate net total cash
  let out := budget q cash net total
  have test := Expressions.zeros c inner "net" "totalUnits" net total hn ht rfl rfl
  simp only [Nat.ne_of_gt np,Nat.ne_of_gt tp,false_or,decide_false] at test
  have choose := Inv32Blocks.branch (n+27) t c inner _ (.returnValues [.word 0]) .skip false test
  have sk : Stmt.eval (n+27) t c inner .skip = pure (.normal inner) := by rw [Stmt.eval]
  have inputs : Inv32FloorHoist.Inputs c inner Bodies.tmp (w "supply").core (w "minimumRate").core
      (.word (10^18)) s rate (10^18) :=
    ⟨Inv32Guards.clean _ _ _ _ _ hs (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hr (Inv32Guards.readWord _ _ _ _ _ rfl),by rfl⟩
  have cl := ceilHoist (n+8) c inner _ _ _ s rate (10^18) hs hr (by decide) (by decide) hc inputs
  have save := Inv32Hoist.declEval (n+27) t c got "reservedCash" .uint256 (castCopy Bodies.tmp).core cash
    (evalFormula (castCopy Bodies.tmp) c got _ (by decide) (castValue _ _ _ _ hc rfl)) (by rw [Ty.coerceValue?])
  have prefixSteps : Stmt.evalList (n+28) t c inner instructions =
      Stmt.evalList (n+28) t c saved (Bodies.rawCheck.value :: tail) :=
    (seqStep _ _ _ _ _ _ _ (choose.trans sk)).trans
      ((seqStep _ _ _ _ _ _ _ (zero (n+27) t c inner Bodies.tmp)).trans
      ((seqStep _ _ _ _ _ _ _ cl).trans (seqStep _ _ _ _ _ _ _ save)))
  have check := checkCash n c r q s rate net total cash hq hn ht tp scaledFits hc hv
  dsimp only at check
  have middle : Stmt.eval (n+29) t c outer (.block instructions) = pure (.returned outer [.word out]) := by
    by_cases low : rawValue q net total<cash
    · rw [if_pos low] at check
      have answer : out=0 := if_pos low
      rw [answer]
      exact blockReturned _ t c outer saved _ _ (prefixSteps.trans (stop _ _ _ _ _ _ _ _ check))
    · rw [if_neg low] at check
      have funded := (funded_iff q cash net total np tp).mp (Nat.le_of_not_gt low)
      have done := fundedTail n c r q s rate net total cash hq hn ht np hc scaledFits funded
      dsimp only at done
      have answer : out=q-reserve cash total net := if_neg low
      rw [answer]
      exact blockReturned _ t c outer _ _ _ (prefixSteps.trans ((seqStep _ _ _ _ _ _ _ check).trans done))
  dsimp only
  rw [bodyCode]
  have a := cleanParamExec (n+28) t c outer "questionUnits" q hq rfl (by dsimp [outer,src,frame]; write_param)
  have b := cleanParamExec (n+28) t c outer "supply" s hs rfl (by dsimp [outer,src,frame]; write_param)
  have e := cleanParamExec (n+28) t c outer "minimumRate" rate hr rfl (by dsimp [outer,src,frame]; write_param)
  have f := cleanParamExec (n+28) t c outer "net" net hn rfl (by dsimp [outer,src,frame]; write_param)
  have g := cleanParamExec (n+28) t c outer "totalUnits" total ht rfl (by dsimp [outer,src,frame]; write_param)
  have skip : Stmt.eval (n+29) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ e).trans
    ((seqStep _ _ _ _ _ _ _ f).trans ((seqStep _ _ _ _ _ _ _ g).trans ((seqStep _ _ _ _ _ _ _ skip).trans
    (stop _ _ _ _ _ _ [] _ middle))))))

end Inv03.Fee
