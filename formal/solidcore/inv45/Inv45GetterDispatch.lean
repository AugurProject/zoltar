import Inv45ScalarBranch
import Inv45PublicShape
open SolidCore.Solidity.Source
namespace Inv45.Public

def firstDecision (s : Stmt) : Option (Expr × Stmt × Stmt) :=
  match s with
  | .block [_,_,_,.block (.ifElse guard yes no :: _)] => some (guard,yes,no)
  | _ => none

theorem getterBranches : ∃ yes no, firstDecision getter.body=some (scalarCheck,yes,no) := by
  rw [getterSource];exact ⟨_,_,rfl⟩

theorem generatedScalarDispatch (n : Nat) (c : Context) (r : Runtime) (question : Nat)
    (fields : c.storageFields=model.core.storageFields) (look : r.lookupLocal? "questionId"=some (.word question))
    (scalar : r.state.loadSlot (labelsSlot question)=0) :
    ∃ guard yes no, firstDecision getter.body=some (guard,yes,no) ∧
      Stmt.eval (n+1) model.core.table c r (.ifElse guard yes no)=Stmt.eval n model.core.table c r yes := by
  obtain ⟨yes,no,found⟩ := getterBranches
  exact ⟨scalarCheck,yes,no,found,selectScalar _ _ _ _ _ _ _ fields look scalar⟩
#print axioms generatedScalarDispatch
end Inv45.Public
