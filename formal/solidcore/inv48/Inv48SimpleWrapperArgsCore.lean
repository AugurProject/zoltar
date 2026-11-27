import Inv48RequestGuardsRegistered
import Inv48WrapperArgsPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def getterKey := "__internal_getSettlementCallbackGasLimit()#[]"
def ret := "_ret_getSettlementCallbackGasLimit_0"
def hoist := "_sol_hoist_0"
def viewName := "#view47617"
def getterCall : Stmt := .captureReturn [ret] (.internalCall [ret] getterKey [])
def getterBlock : Stmt := .block [ .varDecl .uint256 ret none, getterCall,
  .assign (.var hoist) (.var ret)]
def temp (ty : Ty) (name : String) (expr : Expr) : Stmt := .varDecl ty name (some expr)
def requestPrefix : List Stmt := [temp .address "_ic_arg_0" .caller,
  temp .uint256 "_ic_arg_1" (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")),
  temp .uint256 "_ic_arg_2" (.castOp .uintCleanup 256 (.var "requestedInitialAttoWeth")),
  temp .uint256 "_ic_arg_3" (.castOp .uintCleanup 256 (.var "bountyAttoEth")),
  temp .uint256 "_ic_arg_4" (.castOp .uintCleanup 32 (.var viewName)),
  .varDecl .uint256 "_ret__requestPrice_0" none]
def beforeRequest : List Stmt := [.varDecl .uint256 hoist none,getterBlock,
  temp .uint256 viewName (.castOp .uintCleanup 32 (.var hoist)),
  .varDecl .uint256 hoist none]
def call : Stmt := .internalCall ["_ret__requestPrice_0"] Inv48.RequestQuote.requestKey
  Inv48.WrapperArgs.callArgs

def prepared (c : Context) (r : Runtime) (p a b : Nat) : Runtime :=
  {r with locals :=
    [("_ret__requestPrice_0",.word 0),("_ic_arg_4",.word 4000000),
     ("_ic_arg_3",.word b),("_ic_arg_2",.word a),("_ic_arg_1",.word p),
     ("_ic_arg_0",.word (SolidCore.Solidity.Shared.norm c.sender))] ::
    [(hoist,.word 0),(viewName,.word 4000000),(hoist,.word 4000000)] :: r.locals}

theorem preparedValues (c : Context) (r : Runtime) (p a b : Nat) :
    Inv48.WrapperArgs.TempValues (prepared c r p a b)
      (SolidCore.Solidity.Shared.norm c.sender) p a b 4000000 := by
  simp [Inv48.WrapperArgs.TempValues,prepared,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]

def getterBodyP := Stmt_block (seq [Stmt_skip,Stmt_block (seq [Stmt_returnValues
  (seq [Expr_castOp CastKind_uintCast (lit 32)
    (Expr_ternary (Expr_word (lit 1)) (Expr_word (lit 4000000)) (Expr_word (lit 4000000)))])])])
def getterReturnsP := seq [Inv48.EscrowTrace.bindingPattern (lit "_ret0") Ty_uint256 (lit false)]
def getterCheck : Bool := (Inv48.Source.model.core.table.lookup? getterKey).any fun fn =>
  fn.params.isEmpty && getterReturnsP.test fn.returns && getterBodyP.test fn.body

theorem checkedGetter : getterCheck = true := by native_decide

theorem getterMetadata : ∃ fn,
    Inv48.Source.model.core.table.lookup? getterKey = some fn ∧ fn.params = [] ∧
    fn.returns = [⟨"_ret0",.uint256,false⟩] ∧ fn.body = getterBodyP.value := by
  have h := checkedGetter
  cases found : Inv48.Source.model.core.table.lookup? getterKey with
  | none => simp [getterCheck,found] at h
  | some fn =>
    simp only [getterCheck,found,Option.any_some,Bool.and_eq_true] at h
    have empty : fn.params = [] := by simpa using h.1.1
    exact ⟨fn,rfl,empty,getterReturnsP.sound _ h.1.2,
      getterBodyP.sound _ h.2⟩

end Inv48.SimpleWrapperArgs
