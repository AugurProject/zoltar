import Inv45Labels
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
def localize (name : String) : Pattern Source.Stmt where
  value:=.memoryLocalize .bytesCalldata name
  test | .memoryLocalize .bytesCalldata s=>s==name | _=>false
  sound v h := by split at h <;> simp_all
def index (base idx : Pattern Source.Expr) : Pattern Source.Expr where
  value:=.index base.value idx.value
  test | .index x i=>base.test x && idx.test i | _=>false
  sound v h:=by
    split at h
    next x i => simp only [Bool.and_eq_true] at h;rw [base.sound _ h.1,idx.sound _ h.2]
    next => contradiction
def store (name : String) (idx rhs : Pattern Source.Expr) : Pattern Source.Stmt where
  value:=.assign (.index (.var name) idx.value) rhs.value
  test | .assign (.index (.var s) i) e => s==name && idx.test i && rhs.test e | _=>false
  sound v h:=by
    split at h
    next s i e => simp only [Bool.and_eq_true,beq_iff_eq] at h;rw [h.1.1,idx.sound _ h.1.2,rhs.sound _ h.2]
    next => contradiction
def forLoop (cond work : Pattern Source.Stmt) (test : Pattern Source.Expr) : Pattern Source.Stmt where
  value:=.forLoop .skip test.value cond.value work.value
  test | .forLoop .skip e s b => test.test e && cond.test s && work.test b | _=>false
  sound v h:=by
    split at h
    next e s b => simp only [Bool.and_eq_true] at h;rw [test.sound _ h.1.1,cond.sound _ h.1.2,work.sound _ h.2]
    next => contradiction
def loop (limit : Pattern Source.Expr) (work : Pattern Source.Stmt) :=
  let test := Expr_binary BinaryOp_lt (wvar "index") limit
  block [Add.fromVar "index" (num 0),forLoop (Decimal.adjust true "index") (block [work]) test]
def size (name : String) := clean (Inv08.Authority.length (varP name))
def aliasBytes (name from_ : String) := Decimal.mem name (Option_some (varP from_))
def allocatedBytes (name len : String) := Decimal.mem name (Option_some (Decimal.allocBytes len))
end Inv45.Bytes
namespace Inv45.Pad
open Bytes
abbrev key := "__internal___library_ScalarOutcomes_zeroPadLeft(string,uint256)#[SolidCore.Solidity.Ty.string, SolidCore.Solidity.Ty.uint 256]"
def enough := Stmt_ifElse (Shapes.ge (size "valueBytes") (wvar "totalLength")) (ret (varP "value")) Stmt_skip
def zeros := loop (wvar "paddingLength") (store "padded" (varP "index") (num 48))
def copy := loop (size "valueBytes") (store "padded" (Expr_binary BinaryOp_add (varP "paddingLength") (varP "index"))
  (index (varP "valueBytes") (varP "index")))
def actions := [aliasBytes "valueBytes" "value",enough,allocatedBytes "padded" "totalLength",
  Add.fromVar "paddingLength" (MulDiv.sub (wvar "totalLength") (size "valueBytes")),zeros,copy,ret (varP "padded")]
def body := block [localize "value",param "totalLength",Decimal.initRet,block actions]
def fn? := model.core.table.lookup? key
theorem present : fn?.isSome := by native_decide
def fn := fn?.get present
theorem source : fn.body=body.value := body.sound _ (by native_decide)
end Inv45.Pad
