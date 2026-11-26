import Inv36Branch
open SolidCore.Solidity.Source Inv32Shapes Inv32Dispatch
namespace Inv36Source
abbrev key := "__internal___library_TwoWayConstantProductMath_initialLiquidityAmounts(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def paramGuard := Stmt.requireStmt (.binary .boolAnd (Inv32QuoteExpr.positive pn).core
  (Inv32Product.ltF (Inv32QuoteExpr.w pn) Inv32QuoteExpr.bps).core) (some "Invalid initial price")
def amountGuard := Stmt.requireStmt (.binary .boolAnd (Inv32QuoteExpr.positive yn).core
  (Inv32QuoteExpr.positive nn).core) (some "Initial reserves round to zero")
def switchExpr := Expr.binary .ge (Inv32QuoteExpr.w pn).core (.word 5000)
def initializeCode := Stmt.block [Inv32FloorFastPath.cleanParam cn,Inv32FloorFastPath.cleanParam pn,.skip,.skip,
  .block [paramGuard,.ifElse switchExpr (branch true) (branch false),amountGuard]]

private def varP (s : String) := Expr_var (lit s)
private def clean (e : Pattern Expr) := Expr_castOp CastKind_uintCleanup (lit 256) e
private def v (s : String) := clean (varP s)
private def num (n : Nat) := Expr_word (lit n)
private def bpsP := Expr_ternary (num 1) (num 10000) (num 10000)
private def positiveP (s : String) := Expr_binary BinaryOp_gt (v s) (num 0)
private def assignP (s : String) := Stmt_assign (LValue_var (lit s))
private def declare (s : String) := Stmt_varDecl Ty_uint256 (lit s)
private def blockP (ss : List (Pattern Stmt)) := Stmt_block (seq ss)
private def geP : Pattern BinaryOp where
  value := .ge
  test | .ge => true | _ => false
  sound x h := by cases x <;> first | rfl | contradiction
private def capture (targets : List String) (key : String) (args : List String) :=
  let ts := seq (targets.map lit)
  Stmt_captureReturn ts (Stmt_internalCall ts (lit key) (seq (args.map varP)))
private def path (high : Bool) :=
  let less := clean (clean (Expr_binary BinaryOp_sub bpsP (v pn)))
  let ret := Inv32FloorHoist.ret
  blockP [assignP (if high then nn else yn) (v cn),declare flag Option_none,
    blockP [declare "_ic_arg_0" (Option_some (v cn)),declare "_ic_arg_1" (Option_some (if high then less else v pn)),
      declare "_ic_arg_2" (Option_some (if high then v pn else less)),declare ret Option_none,
      capture [ret] Inv32Bodies.Floor.key ["_ic_arg_0","_ic_arg_1","_ic_arg_2"],assignP flag (varP ret)],
    assignP (if high then yn else nn) (clean (Expr_castOp CastKind_uintCast (lit 256) (varP flag)))]
private def entry (ss : List (Pattern Stmt)) := blockP [assignP cn (v cn),assignP pn (v pn),Stmt_skip,Stmt_skip,blockP ss]
private def shape := entry [
  Stmt_requireStmt (Expr_binary BinaryOp_boolAnd (positiveP pn) (Expr_binary BinaryOp_lt (v pn) bpsP)) (Option_some (lit "Invalid initial price")),
  Stmt_ifElse (Expr_binary geP (v pn) (num 5000)) (path true) (path false),
  Stmt_requireStmt (Expr_binary BinaryOp_boolAnd (positiveP yn) (positiveP nn)) (Option_some (lit "Initial reserves round to zero"))]
theorem linked : Inv32Library.Link key [.word cn,.word pn] [.word yn,.word nn] initializeCode := by
  apply Inv32Library.link _ _ _ _ (by native_decide)
  exact (Option_some shape).sound _ (by native_decide)
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev out0 := "_ret___library_TwoWayConstantProductMath_initialLiquidityAmounts_0"
abbrev out1 := "_ret___library_TwoWayConstantProductMath_initialLiquidityAmounts_1"
def callStmt := Stmt.internalCall [out0,out1] key [.var a0,.var a1]
def returnStmt := Stmt.returnValues [.var out0,.var out1]
def inner := Stmt.block [Inv32FloorStart.temp a0 cn,Inv32FloorStart.temp a1 pn,
  .varDecl .uint256 out0 none,.varDecl .uint256 out1 none,.captureReturn [out0,out1] callStmt,returnStmt]
def publicCode := Stmt.block [Inv32FloorFastPath.cleanParam cn,Inv32FloorFastPath.cleanParam pn,.skip,.skip,.block [inner]]
def fn := (model.core.findFunctionByName? "initialLiquidityAmounts").get (by native_decide)
private def publicShape := entry [blockP [declare a0 (Option_some (v cn)),declare a1 (Option_some (v pn)),
  declare out0 Option_none,declare out1 Option_none,capture [out0,out1] key [a0,a1],
  Stmt_returnValues (seq [varP out0,varP out1])]]
theorem publicBodyShape : fn.body = publicCode := publicShape.sound _ (by native_decide)
end Inv36Source
