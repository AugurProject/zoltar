import Inv48FundingFallthroughTraversal
import Inv48FundingFallthroughSource
open SolidCore.Solidity.Source
open Inv48.RequestClassify
namespace Inv48.FundingFallthrough
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def sharedPlanDepth := request.bind fun fn =>
  (certifiedPlan sharedPath Inv48.Source.model.core.table fn.body).map CertifiedPlan.depth

def callsRequest : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block ss => ss.any (callsRequest k)
  | k+1,.captureReturn _ body | k+1,.checked body | k+1,.unchecked body => callsRequest k body
  | _+1,.internalCall _ key _ => key == Inv48.RequestQuote.requestKey
  | k+1,.ifElse _ a b => callsRequest k a || callsRequest k b
  | _+1,_ => false

def wrappers := ["requestSecurityPoolPrice", "requestSecurityPoolPriceWithOperations"]
def wrapperCheck := wrappers.all (fun name =>
    (Inv48.Source.model.core.findFunctionByName? name).any (fun fn => callsRequest 100 fn.body))
def requireCount : Nat → Stmt → Nat
  | 0,_ => 0
  | k+1,.block ss => (ss.map (requireCount k)).sum
  | k+1,.captureReturn _ s => requireCount k s
  | _+1,.requireStmt .. => 1
  | _,_ => 0

def certificate := (sharedPlanDepth == some 3) && wrapperCheck &&
  (requireCount 100 (.block (Inv48.RequestQuote.actual.take 5)) == 5)

theorem checkedCertificate : certificate = true := by native_decide

theorem checkedSharedPlan : sharedPlanDepth = some 3 := by
  have h := checkedCertificate
  simp only [certificate,Bool.and_eq_true,beq_iff_eq] at h
  exact h.1.1

theorem bothWrappersLinked : wrapperCheck = true := by
  have h := checkedCertificate
  simp only [certificate,Bool.and_eq_true] at h
  exact h.1.2

theorem fiveGuards : requireCount 100 (.block (Inv48.RequestQuote.actual.take 5)) = 5 := by
  have h := checkedCertificate
  simp only [certificate,Bool.and_eq_true,beq_iff_eq] at h
  exact h.2
end Inv48.FundingFallthrough
