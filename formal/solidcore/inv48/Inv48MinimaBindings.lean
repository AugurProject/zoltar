import Inv48Model
import Inv12PremiumArgs
import Inv32CeilAdd
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.Minima

theorem immutableRead (c : Context) (r : Runtime) (name : String) (field : ImmutableField)
    (v : Nat) (found : c.immutableField? name = some field)
    (stored : r.state.immutable? name = some (.word v))
    (clean : field.ty.coerceValue? (.word v) = some (.word v)) :
    (Expr.immutable name).evalWithRuntimeByContext c r = .ok (.word v,r) := by
  have load : r.loadImmutableField c name = .ok (.word v) := by
    simp only [Runtime.loadImmutableField,found,stored,clean]
  unfold Expr.evalWithRuntimeByContext Expr.eval
  rw [Expr.evalFuel]
  simp only [load]
  rfl

theorem scalarFieldLoad (c : Context) (r : Runtime) (name : String) (field : StorageField)
    (ty : Ty) (v : Nat) (found : c.storageField? name = some field)
    (layout : field.layout? = some (.scalar ty))
    (decoded : field.storageValueFromWord? ty (r.state.loadFieldWord field) = some (.word v)) :
    r.loadStorageField c name = .ok (.word v) := by
  simp only [Runtime.loadStorageField,found,layout,decoded]

theorem checkedAdd (c : Context) (r : Runtime) (a b : Nat) (ha : a<R) (hb : b<R)
    (fits : a+b<R) (checked : c.checked=true)
    (A : r.lookupLocal? Inv32CeilFlags.h2 = some (.word a))
    (B : r.lookupLocal? Inv32CeilFlags.h3 = some (.word b)) (n : Nat) :
    Stmt.eval (n+1) Inv48.Source.model.core.table c r Inv32CeilAdd.ret =
      pure (.returned r [.word (a+b)]) :=
  Inv32CeilAdd.good n _ c r a b ha hb fits checked
    (by simp [Inv32Actions.locals,A]) (by simp [Inv32Actions.locals,B])

theorem baseDeclaration (n : Nat) (c : Context) (r : Runtime) (field : ImmutableField) (base : Nat)
    (found : c.immutableField? "minimumReportCollateral"=some field)
    (type : field.ty=.uint256)
    (stored : r.state.immutable? "minimumReportCollateral"=some (.word base)) (fit : base<R) :
    Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.varDecl .uint256 "#operand47452" (some (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral")))) =
      pure (.normal (r.declareLocal "#operand47452" (.word base))) := by
  have load : r.loadImmutableField c "minimumReportCollateral"=.ok (.word base) := by
    simp only [Runtime.loadImmutableField,found,stored,type,Ty.coerceValue?]
  have imm (k : Nat) : Expr.evalFuel (k+1) c r (.immutable "minimumReportCollateral")=pure (.word base,r) := by
    rw [Expr.evalFuel,load]; rfl
  have clean : Expr.eval c r (.castOp .uintCleanup 256 (.immutable "minimumReportCollateral"))=pure (.word base,r) :=
    Inv32Guards.clean _ _ _ _ _ fit (imm _)
  exact Inv32Hoist.declEval n _ c r _ .uint256 _ base clean (by rw [Ty.coerceValue?])
end Inv48.Minima
