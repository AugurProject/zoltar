import Inv45PublicReturn
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv45.Public
/-- Runtime created by the real external entry, including balance adoption. -/
def publicEntry (c : Context) (state : State) (question answer : Nat) : Runtime :=
  { state := { state with
      selfBalance := Shared.addWord (Shared.Account.balanceAt c.accountBalances c.self) c.value
      worldMutatedSinceAdoption := true }
    locals := [[("questionId",.word question),("answer",.word answer),("_ret0",.bytes [])]] }

theorem functionCall (fuel : Nat) (c : Context) (before : State)
    (question answer : Nat) (after : Runtime) (bs : List Nat) (out : Value)
    (zeroValue : c.value=0)
    (body : Stmt.eval fuel model.core.table c (publicEntry c before question answer) getter.body = pure (.returned after [out]))
    (holds : Decimal.Holds after bs out) :
    getter.call fuel model.core.table c before [.word question,.word answer] =
      some (pure (.returned {after.state with constructorOutput? := none} [.bytes bs])) := by
  have accepts : getter.acceptsValue c.value=true := by
    obtain ⟨_,_,pay,_,_⟩ := metadata
    simp [FunctionDef.acceptsValue,pay,zeroValue,wordEq]
  unfold FunctionDef.call FunctionDef.evalBodyEntry
  rw [accepts]
  simp only [if_true,initialFrame]
  change some (Functor.map (getter.callBodyResult before)
    (Stmt.eval fuel model.core.table c (publicEntry c before question answer) getter.body)) = _
  rw [successfulBody fuel c _ after before bs out body holds]

theorem selectorCall (fuel : Nat) (before : State) (question answer : Nat)
    (after : Runtime) (bs : List Nat) (out : Value)
    (zeroValue : model.core.context.value=0)
    (body : Stmt.eval fuel model.core.table model.core.context
      (publicEntry model.core.context before question answer) getter.body = pure (.returned after [out]))
    (holds : Decimal.Holds after bs out) :
    model.callTree fuel (.selector 2895153088) before [.word question,.word answer] =
      some (pure (.returned {after.state with constructorOutput? := none} [.bytes bs])) := by
  unfold TypeCheck.CheckedContract.callTree Contract.call Contract.resolveCallFunction?
  simp only [selectorDispatch]
  exact functionCall fuel _ before question answer after bs out zeroValue body holds

theorem selectorCallWithContext (fuel : Nat) (c : Context) (before : State) (question answer : Nat)
    (after : Runtime) (bs : List Nat) (out : Value)
    (zeroValue : c.value=0)
    (body : Stmt.eval fuel model.core.table c
      (publicEntry c before question answer) getter.body = pure (.returned after [out]))
    (holds : Decimal.Holds after bs out) :
    model.callTargetWithContextTree fuel (.selector 2895153088) c before [.word question,.word answer] =
      some (pure (.returned {after.state with constructorOutput? := none} [.bytes bs])) := by
  unfold TypeCheck.CheckedContract.callTargetWithContextTree Contract.resolveCallFunction?
  simp only [selectorDispatch]
  exact functionCall fuel c before question answer after bs out zeroValue body holds

#print axioms functionCall
#print axioms selectorCall
#print axioms selectorCallWithContext
end Inv45.Public
