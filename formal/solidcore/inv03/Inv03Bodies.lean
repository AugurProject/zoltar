import Inv03SettlementMath
import Inv32CeilHoist

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Shapes
namespace Inv03.Bodies

def feeKey := "__internal___library_SecurityPoolSettlementMath_feeBudget(uint256,uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
def rawKey := "__internal___library_SecurityPoolSettlementMath_rawValue(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]"
abbrev rawRet := "_ret___library_SecurityPoolSettlementMath_rawValue_0"
abbrev feeRet := "_ret___library_SecurityPoolSettlementMath_feeBudget_0"
abbrev tmp := Inv32CeilFlags.h0
abbrev viewName := "#view3931"

def varP (n : String) := Expr_var (lit n)
def num (n : Nat) := Expr_word (lit n)
def clean := Expr_castOp CastKind_uintCleanup (lit 256)
def wvar (n : String) := clean (varP n)
def copied := clean (Expr_castOp CastKind_uintCast (lit 256) (varP tmp))
def decl (n : String) := Stmt_varDecl Ty_uint256 (lit n)
def assign (n : String) := Stmt_assign (LValue_var (lit n))
def block (ss : List (Pattern Source.Stmt)) := Stmt_block (seq ss)
def ret (e : Pattern Source.Expr) := Stmt_returnValues (seq [e])
def param (n : String) := assign n (wvar n)
def enumWord (n : Nat) := Expr_enumFromUInt (lit 3) (clean (num n))
def zeros (a b : String) := Expr_binary BinaryOp_boolOr
  (Expr_binary BinaryOp_eq (wvar a) (num 0)) (Expr_binary BinaryOp_eq (wvar b) (num 0))
def scaledUnits (n : String) := clean (clean (Expr_binary BinaryOp_mul (wvar n)
  (Expr_ternary (num 1) (num (10^9)) (num (10^9)))))
def hoist (key slot : String) (params : List (String × Pattern Source.Expr)) :=
  let target := seq [lit slot]
  block (params.map (fun (n,e) => decl n (Option_some e)) ++
    [decl slot Option_none,
     Stmt_captureReturn target (Stmt_internalCall target (lit key) (seq (params.map (fun (n,_) => varP n)))),
     assign tmp (varP slot)])
def call4 (key slot : String) (a b d m : Pattern Source.Expr) := hoist key slot
  [(Inv32FloorHoist.a0,a),(Inv32FloorHoist.a1,b),(Inv32FloorHoist.a2,d),(Inv32CeilHoist.a3,m)]
def mulDiv := call4 Inv32Bodies.Ceil.key Inv32CeilHoist.dest
def rawBody := block [param "weight",param "net",param "units",Stmt_skip,Stmt_skip,block [
  Stmt_ifElse (zeros "weight" "units") (ret (num 0)) (block [decl tmp Option_none,
    mulDiv (wvar "weight") (wvar "net") (scaledUnits "units") (varP "rounding"),ret copied])]]
def rawCheck := block [decl tmp Option_none,
  call4 rawKey rawRet (wvar "questionUnits") (wvar "net") (wvar "totalUnits") (enumWord 0),
  decl viewName (Option_some (wvar tmp)),
  Stmt_ifElse (Expr_binary BinaryOp_gt (wvar "reservedCash") (wvar viewName)) (ret (num 0)) Stmt_skip]
def difference := clean (clean (Expr_binary BinaryOp_sub (wvar "questionUnits") (wvar "reservedUnits")))
def feeBody := block [param "questionUnits",param "supply",param "minimumRate",param "net",param "totalUnits",
  Stmt_skip,block [Stmt_ifElse (zeros "net" "totalUnits") (ret (num 0)) Stmt_skip,
    decl tmp Option_none,mulDiv (wvar "supply") (wvar "minimumRate") (num (10^18)) (enumWord 1),
    decl "reservedCash" (Option_some copied),rawCheck,
    decl tmp Option_none,mulDiv (wvar "reservedCash") (scaledUnits "totalUnits") (wvar "net") (enumWord 1),
    decl "reservedUnits" (Option_some copied),
    Stmt_ifElse (Expr_binary BinaryOp_gt (wvar "questionUnits") (wvar "reservedUnits"))
      (ret difference) (ret (num 0))]]

theorem rawSignature : Inv32Library.LinkAt model.core.table rawKey
    [.word "weight",.word "net",.word "units",.word "rounding"] [.word "_ret0"] rawBody.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some rawBody).sound _ (by native_decide))

theorem feeSignature : Inv32Library.LinkAt model.core.table feeKey
    [.word "questionUnits",.word "supply",.word "minimumRate",.word "net",.word "totalUnits"]
    [.word "_ret0"] feeBody.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some feeBody).sound _ (by native_decide))

end Inv03.Bodies
