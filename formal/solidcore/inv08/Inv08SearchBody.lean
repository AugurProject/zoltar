import Inv08Middle

open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Expiry
def refField (name : String) : Pattern Expr :=
  ⟨.storageRead .ref name [], fun | .storageRead .ref n [] => n == name | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
def endField (name : String) : Pattern Expr :=
  ⟨.index (.storageRead .element "expiries" [.var name]) (.word 0),
    fun | .index (.storageRead .element "expiries" [.var n]) (.word 0) => n == name | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
def logicalNot : Pattern UnaryOp :=
  ⟨.logicalNot, fun | .logicalNot => true | _ => false, by intro x h; cases x <;> simp_all⟩
def typed (name : String) (expr : Pattern Expr) := decl name (Option_some expr)
def atEnd (label index : String) := typed label (clean48 (endField index))
def upperTest := block [
  Stmt_varDecl Ty_bool (lit "#cond736") (Option_some (Expr_binary BinaryOp_eq (w48 "high") (uint48 (num 0)))),
  Stmt_ifElse (Expr_unary logicalNot (varP "#cond736"))
    (block [atEnd "#read733" "high",assign "#cond736" (Expr_binary BinaryOp_le (w48 "#read733") (w48 "timestamp"))]) Stmt_skip,
  Stmt_ifElse (varP "#cond736") (ret (w48 "high")) Stmt_skip]
def lowerInit := typed "low" (twice (Expr_binary BinaryOp_add (clean48 (refField "releasedExpiryId")) (uint48 (num 1))))
def lowerTest := block [atEnd "#read749" "low",Stmt_ifElse (Expr_binary BinaryOp_gt (w48 "#read749") (w48 "timestamp"))
  (ret (clean48 (refField "releasedExpiryId"))) Stmt_skip]
def guard := Expr_binary BinaryOp_lt (w48 "low") (w48 "high")
def past := Expr_binary BinaryOp_le (w48 "#read774") (w48 "timestamp")
def decrement := twice (Expr_binary BinaryOp_sub (w48 "middle") (uint48 (num 1)))
def update := Stmt_ifElse past (assign "low" (w48 "middle")) (assign "high" decrement)
def iteration := block [typed "middle" midpoint,block [atEnd "#read774" "middle",update]]
def whileLoop := Stmt_whileLoop guard iteration
def body := block [assign "timestamp" (w48 "timestamp"),Stmt_skip,block [
  typed "high" (clean48 (refField "lastExpiryId")),upperTest,lowerInit,lowerTest,whileLoop,ret (w48 "low")]]
theorem generatedBody : (model.core.table.lookup? key).map InternalFunction.body = some body.value :=
  (Option_some body).sound _ (by native_decide)
end Inv08.Expiry
