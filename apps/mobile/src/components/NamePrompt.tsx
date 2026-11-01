import { Button, Field, Input, Sheet } from "@shopping-list/ui-native";
import { useEffect, useState } from "react";

interface NamePromptProps {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

// 名前を1つ入れる Sheet(リストやカテゴリの追加と名前の変更)
export function NamePrompt({ open, title, label, initial = "", confirmLabel, onSubmit, onClose }: NamePromptProps) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const submit = () => {
    if (name.trim() === "") return;
    onSubmit(name);
    onClose();
  };
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" disabled={name.trim() === ""} onPress={submit}>
          {confirmLabel}
        </Button>
      }
    >
      <Field label={label}>
        <Input autoFocus value={name} onChangeText={setName} onSubmitEditing={submit} returnKeyType="done" />
      </Field>
    </Sheet>
  );
}
