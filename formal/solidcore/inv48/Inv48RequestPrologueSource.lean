import Inv48RequestPrologueCertificate
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem actualHoist : Inv48.RequestQuote.actual[5]? = some (memoryDeclP Inv48.QuoteTransport.hoist).value := by
  have h := checkedSource
  simp only [sourceCheck,Bool.and_eq_true,beq_iff_eq] at h
  cases eq : Inv48.RequestQuote.actual[5]? with
  | none => simp [eq] at h
  | some stmt =>
    have test : (memoryDeclP Inv48.QuoteTransport.hoist).test stmt = true := by
      simpa [eq] using h.1.1
    exact congrArg some ((memoryDeclP Inv48.QuoteTransport.hoist).sound stmt test)

theorem actualQuoteBlock : Inv48.RequestQuote.actual[6]? = some quoteBlockP.value := by
  have h := checkedSource
  simp only [sourceCheck,Bool.and_eq_true,beq_iff_eq] at h
  cases eq : Inv48.RequestQuote.actual[6]? with
  | none => simp [eq] at h
  | some stmt =>
    have test : quoteBlockP.test stmt = true := by simpa [eq] using h.1.2
    exact congrArg some (quoteBlockP.sound stmt test)

theorem publicRegistered : ∃ fn, publicRequest = some fn ∧ fn.params = quoteParams ∧
    fn.returns = [⟨"reportId",.uint256,false⟩] ∧ fn.payable = true ∧ (outer fn.body).take 4 = publicPrologueP.value := by
  have h := checkedSource
  simp only [sourceCheck,Bool.and_eq_true,beq_iff_eq] at h
  cases eq : publicRequest with
  | none => simp [eq] at h
  | some fn =>
    have test : quoteParamP.test fn.params = true ∧ publicReturnP.test fn.returns = true ∧ fn.payable = true ∧ publicPrologueP.test ((outer fn.body).take 4) = true := by
      simpa [eq,Bool.and_eq_true,and_assoc] using h.2
    exact ⟨fn,rfl,quoteParamP.sound _ test.1,publicReturnP.sound _ test.2.1,test.2.2.1,publicPrologueP.sound _ test.2.2.2⟩
end Inv48.RequestPrologue
