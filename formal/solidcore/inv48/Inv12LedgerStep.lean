import Inv12Delta
import Inv12CashDomain
open SolidCore.Solidity.Source Inv32Division
namespace Inv12

theorem preserveAssigned (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (f b : Ref)
    (cash total old extra : Nat) (before after : List Nat)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (amount : b.hasField 6 5) (ledger : f.hasField 5 5)
    (prev : r.lookupLocal? "previousCash"=some (.word (cash*old/total)))
    (prior : f.get r.state 5=assigned cash total (before++[old]++after))
    (updated : b.get r.state 5=cash*(old+extra)/total)
    (word : cash<R) (tw : total<R) (positive : 0<total) (covered : (before++[old+extra]++after).sum≤total) :
    ∃ next, Stmt.eval (n+1) t c r (.exprStmt (addMember "fork" 5 deltaExpr))=pure (.normal next) ∧
      f.get next.state 5=assigned cash total (before++[old+extra]++after) := by
  obtain ⟨_,_,monotone,safe⟩ := choiceWords cash total old extra before after word tw positive covered
  rw [←updated] at monotone safe
  rw [←prior] at safe
  refine ⟨_,recordsDelta n t c r f b _ fork branch amount ledger prev monotone safe,?_⟩
  change amountAt (putAmount r.state f.slot 5 _) f.slot 5=_
  rw [amountAfter _ _ _ _ safe,prior,updated,replaceBranch]
end Inv12
