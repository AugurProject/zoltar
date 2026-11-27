import Inv39GetterBinding
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath
namespace Inv39.Getter
theorem expression (k : Kind) (c : Context) (r : Runtime) (n : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (fit : WordField.stored r.state (field k)<R) :
    (retExpr k).value.evalFuel (n+2) c r = pure (.word (WordField.stored r.state (field k)),r) := by
  have found : c.storageField? (field k).name = some (field k).field := by
    change c.storageFields.find? _ = _
    rw [fields]
    cases k <;> first | exact layout.1 | exact layout.2
  have load : r.loadStorageField c (field k).name = .ok (.word (WordField.stored r.state (field k))) := by
    unfold Runtime.loadStorageField
    rw [found]
    rfl
  apply Inv32Guards.clean
  · exact fit
  · change Source.Expr.evalFuel (n+1) c r (.storageRead .ref (field k).name []) = _
    rw [Source.Expr.evalFuel]
    change (do let v ← liftM (r.loadStorageField c (field k).name); pure (v,r)) = _
    rw [load]; rfl
theorem run (k : Kind) (t : FunctionTable) (c : Context) (r : Runtime) (n : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (fit : WordField.stored r.state (field k)<R) :
    Stmt.eval (n+3) t c r (shape k).value = pure (.returned r [.word (WordField.stored r.state (field k))]) := by
  let inner := r.pushScope.pushScope
  have expr : Source.Expr.evalReturnValue c inner (retExpr k).value = _ := expression k c inner 2 fields fit
  have vals : Source.Expr.evalReturnList c inner [(retExpr k).value] = pure ([.word (WordField.stored r.state (field k))],inner) := by
    change Source.Expr.evalReturnListFuel (_+1+1) c inner [(retExpr k).value] = _
    rw [Source.Expr.evalReturnListFuel,expr]; rfl
  have tail : Stmt.eval (n+1) t c inner (.returnValues [(retExpr k).value]) = pure (.returned inner [.word (WordField.stored r.state (field k))]) := by
    rw [Stmt.eval]; dsimp only; rw [vals]; rfl
  have block := blockReturned _ t c r.pushScope inner _ _ (stop _ _ _ _ _ _ [] _ tail)
  have skip : Stmt.eval (n+2) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  apply blockReturned (next:=r.pushScope)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ block)
theorem publicRead (k : Kind) (s : State) (fit : WordField.stored s (field k)<R) :
    CheckedWordCall.read model s (name k) [] = some (WordField.stored s (field k)) := by
  obtain ⟨f,found,ps,rs,bd⟩ := linked k
  let c := CheckedWordCall.ctx model
  have frame : f.initialFrame? [] = some [("_ret0",.word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgs?,Inv32Internal.wordBindings,BindingDecl.defaultBinding,Ty.defaultValue]
  let r := (CheckedWordCall.initial c s).withFrame [("_ret0",.word 0)]
  have ev := run k model.core.table c r 49997 rfl fit
  rw [←bd] at ev
  exact CheckedWordCall.returnsWord _ _ _ _ _ _ _ found frame rs (by simp [FunctionDef.acceptsValue,CheckedWordCall.ctx,Contract.context,wordEq]) ev
end Inv39.Getter
