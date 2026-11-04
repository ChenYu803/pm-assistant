"use client";
import { useMemo, useSyncExternalStore } from "react";
function subscribe(listener: () => void) {
  window.addEventListener("storage",listener);window.addEventListener("manual-refund",listener);
  return () => {window.removeEventListener("storage",listener);window.removeEventListener("manual-refund",listener);};
}
/** 发送前保留原身份和内容；未知响应及刷新均只能核对或重试同一操作。 */
export function useRefundDraft<T>(key: string, validate: (value: unknown) => value is T) {
  const saved=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(key);}catch{return "!unavailable";}},()=>undefined);
  const pending=useMemo(()=>{if(!saved)return null;try {const value:unknown=JSON.parse(saved);return validate(value)?value:null;}catch{return null;}},[saved,validate]);
  function remember(value: T | null) {
    if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);
    window.dispatchEvent(new Event("manual-refund"));
  }
  return {pending,remember,ready:saved!==undefined&&!(saved&&!pending)};
}
