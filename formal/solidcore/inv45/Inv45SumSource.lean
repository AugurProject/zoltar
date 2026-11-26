import Inv45ValidSum
import Inv45GetterDispatch
open SolidCore.Solidity.Source
namespace Inv45.Public
def selectSum (body : Stmt) : Option Stmt := do
  let (_,yes,_) ← firstDecision body
  let .block xs := yes | none
  xs.find? fun | .varDecl .uint256 "sum" _ => true | _ => false

theorem getterSum : selectSum getter.body=some (.varDecl .uint256 "sum" (some tickSum)) := by
  rw [getterSource];rfl

theorem generatedSum (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat)
    (N : n<Answer.radix) (valid : k≤n) (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k)) :
    ∃ stmt,selectSum getter.body=some stmt ∧
      Stmt.eval (fuel+1) model.core.table c r stmt=pure (.normal (r.declareLocal "sum" (.word n))) :=
  ⟨_,getterSum,sumDeclaration _ _ _ _ _ N valid first second⟩
#print axioms generatedSum
end Inv45.Public
