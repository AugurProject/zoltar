import Inv12Calldata
open SolidCore.Solidity.Source
namespace Inv12

theorem wordFromRead (c : Context) (r : Runtime) (e : Expr) (v : Nat)
    (read : Inv40.Reads c r e v) : e.evalWithRuntimeByContext c r=.ok (.word v,r) := by
  unfold Expr.evalWithRuntimeByContext
  have h : e.eval c r=pure (.word v,r) := read _ (Nat.le_succ _)
  rw [h];rfl

theorem premiumArgumentValues (c : Context) (r : Runtime) (f b : Ref) (source child : Nat)
    (src : r.lookupLocal? "source"=some (.word source)) (ch : r.lookupLocal? "child"=some (.word child))
    (fork : f.bound r "fork") (branch : b.bound r "branch") (chosen : b.hasField 5 4) (total : f.hasField 1 1) :
    List.Forall₂ (Inv40.Reads c r)
      [.var "source",.var "child",.index (.var "branch") (.word 5),.index (.var "fork") (.word 1)]
      [source,child,b.get r.state 4,f.get r.state 1] :=
  .cons (Inv08.localReads c r _ _ src) (.cons (Inv08.localReads c r _ _ ch)
    (.cons (readAmount _ _ _ _ _ _ _ (by decide) branch chosen)
    (.cons (readAmount _ _ _ _ _ _ _ (by decide) fork total) .nil)))

end Inv12
