import Inv32Dispatch
open SolidCore.Solidity.Source
namespace Inv32CoreBodies
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def inputBody : Stmt :=
  Stmt.block
    [Stmt.assign
       (LValue.var "reserveIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveIn")),
     Stmt.assign
       (LValue.var "reserveOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveOut")),
     Stmt.assign
       (LValue.var "amountIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "amountIn")),
     Stmt.assign
       (LValue.var "feeBps")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "feeBps")),
     Stmt.skip,
     Stmt.skip,
     Stmt.block
       [Stmt.block
          [Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_0"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_1"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_2"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "amountIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_3"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "feeBps"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactInput_0"
             none,
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"
             none,
           Stmt.captureReturn
             ["_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
              "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]
             (Stmt.internalCall
               ["_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
                "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]
               "__internal___library_TwoWayConstantProductMath_quoteExactInput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
               [Expr.var "_ic_arg_0",
                Expr.var "_ic_arg_1",
                Expr.var "_ic_arg_2",
                Expr.var "_ic_arg_3"]),
           Stmt.returnValues
             [Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
              Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]]]]

private def matchesinput : Stmt → Bool
  | Stmt.block
    [Stmt.assign
       (LValue.var "reserveIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveIn")),
     Stmt.assign
       (LValue.var "reserveOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveOut")),
     Stmt.assign
       (LValue.var "amountIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "amountIn")),
     Stmt.assign
       (LValue.var "feeBps")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "feeBps")),
     Stmt.skip,
     Stmt.skip,
     Stmt.block
       [Stmt.block
          [Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_0"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_1"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_2"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "amountIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_3"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "feeBps"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactInput_0"
             none,
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"
             none,
           Stmt.captureReturn
             ["_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
              "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]
             (Stmt.internalCall
               ["_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
                "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]
               "__internal___library_TwoWayConstantProductMath_quoteExactInput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
               [Expr.var "_ic_arg_0",
                Expr.var "_ic_arg_1",
                Expr.var "_ic_arg_2",
                Expr.var "_ic_arg_3"]),
           Stmt.returnValues
             [Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactInput_0",
              Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactInput_1"]]]] => true
  | _ => false

private theorem recognizeinput (s : Stmt) (h : matchesinput s = true) : s = inputBody := by
  unfold matchesinput at h
  split at h
  · rfl
  · contradiction

theorem generatedinput : (Inv32Dispatch.selected .forward).body = inputBody :=
  recognizeinput _ (by native_decide)

def outputBody : Stmt :=
  Stmt.block
    [Stmt.assign
       (LValue.var "reserveIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveIn")),
     Stmt.assign
       (LValue.var "reserveOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveOut")),
     Stmt.assign
       (LValue.var "amountOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "amountOut")),
     Stmt.assign
       (LValue.var "feeBps")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "feeBps")),
     Stmt.skip,
     Stmt.skip,
     Stmt.block
       [Stmt.block
          [Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_0"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_1"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_2"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "amountOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_3"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "feeBps"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactOutput_0"
             none,
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"
             none,
           Stmt.captureReturn
             ["_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
              "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]
             (Stmt.internalCall
               ["_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
                "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]
               "__internal___library_TwoWayConstantProductMath_quoteExactOutput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
               [Expr.var "_ic_arg_0",
                Expr.var "_ic_arg_1",
                Expr.var "_ic_arg_2",
                Expr.var "_ic_arg_3"]),
           Stmt.returnValues
             [Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
              Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]]]]

private def matchesoutput : Stmt → Bool
  | Stmt.block
    [Stmt.assign
       (LValue.var "reserveIn")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveIn")),
     Stmt.assign
       (LValue.var "reserveOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "reserveOut")),
     Stmt.assign
       (LValue.var "amountOut")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "amountOut")),
     Stmt.assign
       (LValue.var "feeBps")
       (Expr.castOp
         (CastKind.uintCleanup)
         256
         (Expr.var "feeBps")),
     Stmt.skip,
     Stmt.skip,
     Stmt.block
       [Stmt.block
          [Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_0"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveIn"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_1"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "reserveOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_2"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "amountOut"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ic_arg_3"
             (some (Expr.castOp
                (CastKind.uintCleanup)
                256
                (Expr.var "feeBps"))),
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactOutput_0"
             none,
           Stmt.varDecl
             (Ty.uint256)
             "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"
             none,
           Stmt.captureReturn
             ["_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
              "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]
             (Stmt.internalCall
               ["_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
                "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]
               "__internal___library_TwoWayConstantProductMath_quoteExactOutput(uint256,uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256]"
               [Expr.var "_ic_arg_0",
                Expr.var "_ic_arg_1",
                Expr.var "_ic_arg_2",
                Expr.var "_ic_arg_3"]),
           Stmt.returnValues
             [Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactOutput_0",
              Expr.var "_ret___library_TwoWayConstantProductMath_quoteExactOutput_1"]]]] => true
  | _ => false

private theorem recognizeoutput (s : Stmt) (h : matchesoutput s = true) : s = outputBody := by
  unfold matchesoutput at h
  split at h
  · rfl
  · contradiction

theorem generatedoutput : (Inv32Dispatch.selected .inverse).body = outputBody :=
  recognizeoutput _ (by native_decide)
end Inv32CoreBodies
