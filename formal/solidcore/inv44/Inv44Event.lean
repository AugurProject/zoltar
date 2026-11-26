import Inv44Constructor
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44.Constructor
abbrev eventName := "DeploymentAddressesSet"
def topic : Nat := 6931891043795711501447959464543605198641680688547052028480950274912172638829
def declaration : Source.EventDecl := {name:=eventName,indexedCount:=0,topic?:=some topic,fields:=[⟨ty,false⟩]}
private def matchesEvent : Option Source.EventDecl → Bool
  | some ⟨"DeploymentAddressesSet",0,some h,[⟨.dynamicArray .address,false⟩]⟩ => h==topic
  | _=>false
theorem eventLookup (c : Context) (fields : c.eventDecls=model.core.context.eventDecls) :
    c.eventDecl? eventName=some declaration := by
  change c.eventDecls.find? _=_
  rw [fields]
  change model.core.context.eventDecl? eventName=_
  have h : matchesEvent (model.core.context.eventDecl? eventName) := by native_decide
  generalize model.core.context.eventDecl? eventName=x at *
  unfold matchesEvent at h
  split at h
  · rw [beq_iff_eq.mp h];rfl
  · contradiction
def addressBytes (xs : List Nat) := xs.flatMap (wordToBytesBE wordBytes)
def payload (xs : List Nat) := wordToBytesBE wordBytes xs.length ++ addressBytes xs
def dataBytes (xs : List Nat) := wordToBytesBE wordBytes wordBytes ++ payload xs
def event (xs : List Nat) : Event := {name:=eventName,indexed:=[],data:=[array xs],topics:=[topic],dataBytes:=dataBytes xs}
def logged (s : State) (xs : List Nat) := {s with events:=Shared.Log.append s.events (event xs),worldMutatedSinceAdoption:=true}
def valid (xs : List Nat) := ∀ x, x∈xs → x<2^160

theorem dynamicEncoding (xs : List Nat) (valids : valid xs) : abiEncodeDynamicPayload? ty (array xs)=some (payload xs) := by
  have elements (i : Nat) : abiEncodeDynamicPayload?.encodeValues .address (xs.map Value.word) i=some (addressBytes xs,[],i) := by
    induction xs with
    | nil => rw [List.map_nil,abiEncodeDynamicPayload?.encodeValues];rfl
    | cons x xs ih =>
      have bound := valids x (by simp)
      have h : abiAddressFits x=true := by
        unfold abiAddressFits
        rw [show Shared.norm x=x from Nat.mod_eq_of_lt (lt_trans bound (by decide : 2^160<R))]
        exact decide_eq_true bound
      have a : abiEncodeStaticValue? .address (.word x)=some (wordToBytesBE wordBytes x) := by
        simp [abiEncodeStaticValue?,abiStaticBytes?,h]
      have rest := ih (fun z mem=>valids z (by simp [mem]))
      rw [List.map_cons,abiEncodeDynamicPayload?.encodeValues];simp only [Ty.isDynamicAbi,Bool.false_eq_true,if_false,a,rest]
      rfl
  unfold array
  rw [abiEncodeDynamicPayload?]
  simp [Ty.abiHeadWords?,Ty.isDynamicAbi,Ty.staticAbiHeadWords?,elements,payload]

theorem encode (xs : List Nat) (v : valid xs) : declaration.encodeFields? [array xs] =
    some ⟨[topic],dataBytes xs,[],[array xs]⟩ := by
  have args : abiEncodeValues? [ty] [array xs]=some (dataBytes xs) := by
    unfold abiEncodeValues?
    simp [Ty.listAbiHeadWords?,Ty.abiHeadWords?,abiEncodeValuesAux?,Ty.isDynamicAbi,dynamicEncoding xs v,dataBytes,Bind.bind,Option.bind]
  unfold EventDecl.encodeFields?
  change (match abiEncodeValues? [ty] [array xs] with
      | some data=>some (⟨[topic],data,[],[array xs]⟩ : EventEncoding) | none=>none)=_
  rw [args]

theorem emitResult (c : Context) (r : Runtime) (xs : List Nat) (fields : c.eventDecls=model.core.context.eventDecls) (v : valid xs) :
    r.emitEvent c eventName [array xs]=.ok {r with state:=logged r.state xs} := by
  have u : (array xs).untagFixedBytes=array xs := by
    simp [array,Value.untagFixedBytes,List.map_map,Function.comp_def]
  unfold Runtime.emitEvent
  simp only [List.map_cons,List.map_nil,u]
  have d := eventLookup c fields
  have shape : declaration.fields.isEmpty=false := rfl
  simp only [eventName,d,Bind.bind,Option.bind]
  simp only [show ("DeploymentAddressesSet" == "#yul.log4" || "DeploymentAddressesSet" == "#yul.log2")=false from rfl,
    shape,Bool.false_and,Bool.false_eq_true,if_false,encode xs v]
  rfl
end Inv44.Constructor
