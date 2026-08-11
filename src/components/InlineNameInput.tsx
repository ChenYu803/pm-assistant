"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * 内联改名输入框：挂载即聚焦全选，Enter 提交（非空才生效）、Escape 取消、
 * 失焦提交——工作记录列表行内改名与工作区顶栏改名共用（v1.1 命名体验）。
 * 提交方自行处理 PATCH 与失败回滚。
 */
interface InlineNameInputProps {
  /** 当前名称，作为输入初值 */
  value: string;
  /** 提交新名称（已 trim，保证非空） */
  onSubmit: (newName: string) => void;
  /** 取消编辑（Escape / 空值失焦） */
  onCancel: () => void;
  className?: string;
}

export default function InlineNameInput({
  value,
  onSubmit,
  onCancel,
  className,
}: InlineNameInputProps) {
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // 是否跳过失焦提交（Escape 已按取消处理，失焦不再提交）
  const skipBlurRef = useRef(false);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  function commit() {
    const trimmed = editValue.trim();
    if (trimmed) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      skipBlurRef.current = true;
      onCancel();
    }
  }

  function handleBlur() {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    commit();
  }

  return (
    <Input
      ref={inputRef}
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      className={`h-auto px-1.5 py-0.5 shadow-none focus:ring-2 ${className ?? ""}`}
    />
  );
}
