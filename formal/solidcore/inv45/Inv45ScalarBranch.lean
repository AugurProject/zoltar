import Inv45LabelsLength
open SolidCore.Solidity.Source
namespace Inv45.Public

def scalarCheck := Expr.binary .eq (.castOp .uintCleanup 256 lengthExpr) (.word 0)

theorem scalarCheckReads (c : Context) (r : Runtime) (question : Nat)
    (fields : c.storageFields=model.core.storageFields) (look : r.lookupLocal? "questionId"=some (.word question))
    (scalar : r.state.loadSlot (labelsSlot question)=0) : Inv40.Reads c r scalarCheck 1 := by
  have read := lengthReads c r question fields look
  rw [scalar] at read
  have cleaned := Inv08.ReleaseQuote.readClean read (by decide : 0<Inv32Division.R)
  exact Inv08.ReleaseQuote.binary cleaned (Inv08.Authority.literal c r 0 (by decide)) .eq
    (by intro h;cases h) (by intro h;cases h) rfl

theorem selectScalar (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (question : Nat)
    (onScalar onOther : Stmt) (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word question)) (scalar : r.state.loadSlot (labelsSlot question)=0) :
    Stmt.eval (fuel+1) t c r (.ifElse scalarCheck onScalar onOther)=Stmt.eval fuel t c r onScalar := by
  have value : Expr.eval c r scalarCheck=pure (.word 1,r) := scalarCheckReads _ _ _ fields look scalar _ (by decide)
  rw [Stmt.eval];dsimp only;rw [value];rfl
#print axioms selectScalar
end Inv45.Public
