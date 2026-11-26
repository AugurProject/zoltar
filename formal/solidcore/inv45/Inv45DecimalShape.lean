import Inv45Decimal
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
abbrev key := "__internal___library_DecimalStrings_toString(uint256)#[SolidCore.Solidity.Ty.uint 256]"
abbrev number := "absoluteValue"
def bytesLiteral (bs : List Nat) : Pattern Source.Expr where
  value:=.byteArray bs
  test | .byteArray v=> v==bs | _=>false
  sound v h := by split at h <;> simp_all
def notZero (name : String) := Expr_binary (⟨.ne,(fun | .ne=>true | _=>false),by intro v h;cases v <;> simp_all⟩) (wvar name) (num 0)
def adjust (incr : Bool) (name : String) : Pattern Source.Stmt where
  value:=.exprStmt (.incDec (if incr then .add else .sub) true (some (.uint 256)) (.var name))
  test
    | .exprStmt (.incDec .add true (some (.uint 256)) (.var s)) => incr && s==name
    | .exprStmt (.incDec .sub true (some (.uint 256)) (.var s)) => !incr && s==name
    | _=>false
  sound v h:= by split at h <;> cases incr <;> simp_all
def allocBytes (name : String) : Pattern Source.Expr where
  value:=.newBytes (.var name)
  test | .newBytes (.var s)=> s==name | _=>false
  sound v h:= by split at h <;> simp_all
def mem (name : String) (e : Pattern (Option Source.Expr)) : Pattern Source.Stmt where
  value:=.memoryVarDecl .bytesCalldata name e.value
  test | .memoryVarDecl .bytesCalldata s v=> s==name && e.test v | _=>false
  sound v h:= by
    split at h
    next s v => simp only [Bool.and_eq_true,beq_iff_eq] at h;rw [h.1,e.sound _ h.2]
    next => contradiction
def initRet : Pattern Source.Stmt where
  value:=.memoryLocalize .bytesCalldata "_ret0"
  test | .memoryLocalize .bytesCalldata "_ret0"=>true | _=>false
  sound v h:= by split at h <;> simp_all
def digitCast := Expr_castOp (⟨.fixedBytes 1,(fun | .fixedBytes 1=>true | _=>false),by intro v h;dsimp only at h;split at h <;> simp_all⟩) (lit 1)
def u8 := Expr_castOp CastKind_uintCast (lit 8)
def c8 := Expr_castOp CastKind_uintCleanup (lit 8)
def encodedDigit :=
  let rem := MulDiv.twice (MulDiv.twice (Expr_binary BinaryOp_mod (wvar number) (num 10)))
  digitCast (u8 (c8 (c8 (Expr_binary BinaryOp_add (u8 (num 48)) (u8 rem)))))
def writeByte (e : Pattern Source.Expr) : Pattern Source.Stmt where
  value:=.assign (.index (.var "buffer") (.var "digits")) e.value
  test | .assign (.index (.var "buffer") (.var "digits")) v=>e.test v | _=>false
  sound v h:= by
    split at h
    next e' => rw [e.sound _ h]
    next => contradiction
def divide (name : String) := MulDiv.compound name BinaryOp_div (num 10)
def countBody := block [adjust true "digits",divide "tempValue"]
def countLoop := Stmt_whileLoop (notZero "tempValue") countBody
def digitBody := block [adjust false "digits",writeByte encodedDigit,divide number]
def digitLoop := Stmt_whileLoop (notZero number) digitBody
def data := [Stmt_ifElse (MulDiv.equalZero (wvar number)) (ret (bytesLiteral [48])) Stmt_skip,
  Add.fromVar "tempValue" (wvar number),decl "digits" Option_none,countLoop,
  mem "buffer" (Option_some (allocBytes "digits")),digitLoop,ret (varP "buffer")]
def body := block [param number,initRet,block data]
def fn? := model.core.table.lookup? key
theorem present : fn?.isSome := by native_decide
def fn := fn?.get present
theorem source : fn.body=body.value := body.sound _ (by native_decide)
end Inv45.Decimal
